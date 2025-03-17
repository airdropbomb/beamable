const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

const proxyFile = 'proxy.txt';
const tokenFile = 'token.txt';
const baseCheckinFile = 'last_checkin_time_';
const outputDir = 'output';

async function ensureOutputDir(accountId) {
    const accountDir = path.join(outputDir, accountId);
    await fs.mkdir(accountDir, { recursive: true });
    return accountDir;
}

async function getProxies() {
    try {
        const data = await fs.readFile(proxyFile, 'utf8');
        const proxies = data.split('\n').map(line => line.trim()).filter(line => line);
        if (proxies.length === 0) throw new Error('No proxies found in proxy.txt');
        return proxies;
    } catch (error) {
        console.log(`No proxy file found or error reading proxy.txt: ${error.message}. Proceeding without proxy.`);
        return null;
    }
}

async function getTokenData() {
    try {
        const data = await fs.readFile(tokenFile, 'utf8');
        const lines = data.split('\n').map(line => line.trim()).filter(line => line);
        const tokenData = {};

        for (const line of lines) {
            const [accountId, rest] = line.split('=', 2);
            if (accountId && rest) {
                const harborSessionPrefix = 'harborSession=';
                if (rest.startsWith(harborSessionPrefix)) {
                    const value = rest.slice(harborSessionPrefix.length);
                    tokenData[accountId] = value;
                    console.log(`Account ${accountId}: Raw cookie value from token.txt - ${value}`);
                } else {
                    console.error(`Account ${accountId}: Invalid format in token.txt - ${rest}`);
                }
            }
        }

        if (Object.keys(tokenData).length === 0) {
            throw new Error('No valid harbor-session cookies found in token.txt');
        }
        return tokenData;
    } catch (error) {
        console.error(`Error reading token.txt: ${error.message}`);
        process.exit(1);
    }
}

async function getLastCheckinTime(accountId) {
    const fileName = `${baseCheckinFile}${accountId}.txt`;
    try {
        const data = await fs.readFile(fileName, 'utf8');
        return parseInt(data, 10) || 0;
    } catch (error) {
        return 0;
    }
}

async function setLastCheckinTime(accountId, timestamp) {
    const fileName = `${baseCheckinFile}${accountId}.txt`;
    await fs.writeFile(fileName, timestamp.toString(), 'utf8');
}

function getRandomProxy(proxies) {
    if (!proxies) return null;
    const randomIndex = Math.floor(Math.random() * proxies.length);
    return proxies[randomIndex];
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function processTokenWithRetry(proxies, accountId, harborSession, maxRetries = 3) {
    const lastCheckinTime = await getLastCheckinTime(accountId);
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    if (now - lastCheckinTime < twentyFourHours) {
        const timeLeft = twentyFourHours - (now - lastCheckinTime);
        const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        console.log(`Account ${accountId}: Daily check-in already completed. Please wait ${hoursLeft}h ${minutesLeft}m before next attempt.`);
        return;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const selectedProxy = getRandomProxy(proxies);
        console.log(`Account ${accountId} - Attempt ${attempt}/${maxRetries} ${selectedProxy ? `- Using proxy: ${selectedProxy}` : '- No proxy used'}`);

        let browser;
        try {
            const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
            if (selectedProxy) {
                const proxyParts = selectedProxy.replace('http://', '').split('@');
                let proxyServer, auth = '';
                if (proxyParts.length > 1) {
                    auth = proxyParts[0];
                    proxyServer = proxyParts[1];
                } else {
                    proxyServer = proxyParts[0];
                }
                launchArgs.push(`--proxy-server=${proxyServer}`);
                var [username, pass] = auth ? auth.split(':') : [null, null];
            }

            browser = await puppeteer.launch({
                headless: true,
                args: launchArgs
            });
            const page = await browser.newPage();

            await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

            console.log(`Account ${accountId}: Setting cookie - ${harborSession}`);
            await page.setCookie({
                name: 'harbor-session',
                value: harborSession,
                domain: 'hub.beamable.network',
                path: '/',
                httpOnly: true,
                secure: true
            });

            console.log(`Account ${accountId}: Checking cookie expiration...`);
            await page.goto('https://hub.beamable.network/modules/dailycheckin', { waitUntil: 'networkidle2', timeout: 60000 });
            const cookies = await page.cookies();
            const harborCookie = cookies.find(cookie => cookie.name === 'harbor-session');
            if (harborCookie) {
                if (harborCookie.expires) {
                    const expireDate = new Date(harborCookie.expires * 1000);
                    const now = new Date();
                    const timeLeft = harborCookie.expires * 1000 - now;
                    const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
                    const hoursLeft = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    
                    console.log(`Account ${accountId}: Cookie expires on ${expireDate.toLocaleString()}`);
                    if (timeLeft <= 0) {
                        console.log(`Account ${accountId}: Cookie has already expired!`);
                        await browser.close();
                        return;
                    } else {
                        console.log(`Account ${accountId}: Cookie will expire in ${daysLeft} days and ${hoursLeft} hours`);
                    }
                } else {
                    console.log(`Account ${accountId}: No expiration set (session cookie)`);
                }
            } else {
                console.log(`Account ${accountId}: harbor-session cookie not found on page`);
            }

            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9,my;q=0.8',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Referer': 'https://hub.beamable.network/onboarding/login',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
            });

            if (username && pass) {
                await page.authenticate({ username, password: pass });
            }

            console.log(`Account ${accountId}: Navigating to daily check-in page with harbor-session token...`);
            await delay(30000);

            await page.evaluate(() => {
                const sidebar = document.querySelector('.sidebar');
                if (sidebar && window.getComputedStyle(sidebar).width === '0px') {
                    const toggle = document.querySelector('.sidebar-toggle');
                    if (toggle) toggle.click();
                }
            });
            await delay(2000);

            await page.waitForFunction(() => {
                const buttons = document.querySelectorAll('button');
                return Array.from(buttons).some(button => 
                    button.textContent.trim().toLowerCase().includes('claim')
                );
            }, { timeout: 30000 });

            const currentUrl = page.url();
            console.log(`Account ${accountId}: Current URL: ${currentUrl}`);

            if (currentUrl.includes('/onboarding/login') || currentUrl.includes('/onboarding/confirm')) {
                console.log(`Account ${accountId}: Session expired. Please update harborSession cookie manually in token.txt using login link from email.`);
                await browser.close();
                return;
            } else if (currentUrl.includes('/dashboard') || currentUrl.includes('/modules/dailycheckin')) {
                console.log(`Account ${accountId}: Successfully logged in or redirected to dashboard/daily check-in page.`);
            } else {
                console.log(`Account ${accountId}: Redirected to an unexpected page.`);
            }

            const pageText = await page.evaluate(() => document.body.innerText);
            if (pageText.toLowerCase().includes('claimed') || pageText.toLowerCase().includes('already claimed') || pageText.toLowerCase().includes('check-in complete')) {
                console.log(`Account ${accountId}: Daily check-in already completed. Updating last check-in time.`);
                await setLastCheckinTime(accountId, now);
            } else {
                const dayGroups = await page.$$('div.relative.flex.flex-col.group');
                let claimButtonFound = false;

                console.log(`Account ${accountId}: Found ${dayGroups.length} day groups to check.`);

                for (const group of dayGroups) {
                    const isVisible = await page.evaluate(el => {
                        const style = window.getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.top >= 0 && rect.left >= 0;
                    }, group);

                    if (!isVisible) {
                        console.log(`Account ${accountId}: Found a day group, but it is not visible. Skipping...`);
                        continue;
                    }

                    const buttons = await group.$$('button');
                    for (const button of buttons) {
                        const buttonText = await page.evaluate(el => el.textContent.trim().toLowerCase(), button);
                        const buttonClass = await page.evaluate(el => el.className, button);

                        console.log(`Account ${accountId}: Checking button with class "${buttonClass}" and text "${buttonText}"`);

                        if (
                            buttonText.includes('claim') || 
                            buttonText.includes('check in') || 
                            buttonText.includes('check-in') || 
                            buttonText.includes('get reward') || 
                            buttonText.includes('daily check-in')
                        ) {
                            console.log(`Account ${accountId}: Found a "${buttonText}" button, attempting to click...`);
                            await page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), button);

                            const isClickable = await page.evaluate((el) => {
                                const rect = el.getBoundingClientRect();
                                const style = window.getComputedStyle(el);
                                return rect.width > 0 && rect.height > 0 && style.visibility === 'visible' && style.display !== 'none';
                            }, button);

                            if (isClickable) {
                                try {
                                    await button.click();
                                    await delay(3000);
                                    claimButtonFound = true;
                                    console.log(`Account ${accountId}: Claim successful`);
                                    await setLastCheckinTime(accountId, now);
                                    break;
                                } catch (clickError) {
                                    console.log(`Account ${accountId}: Click failed with error: ${clickError.message}, trying JavaScript click...`);
                                    await page.evaluate((el) => el.click(), button);
                                    await delay(3000);
                                    claimButtonFound = true;
                                    console.log(`Account ${accountId}: Claim successful`);
                                    await setLastCheckinTime(accountId, now);
                                    break;
                                }
                            } else {
                                console.log(`Account ${accountId}: Button is not clickable.`);
                            }
                        }
                    }
                    if (claimButtonFound) break;
                }

                if (!claimButtonFound) {
                    console.log(`Account ${accountId}: No "Claim" or related button found or clickable. Daily check-in may already be completed, or session may have expired.`);
                }
            }

            const accountDir = await ensureOutputDir(accountId);
            const content = await page.content();
            await fs.writeFile(path.join(accountDir, 'dailycheckin_page.html'), content, 'utf8');
            console.log(`Account ${accountId}: Full page content saved to ${path.join(accountDir, 'dailycheckin_page.html')}`);

            const data = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'))
                    .filter(b => b.textContent.trim().length > 0)
                    .map(b => {
                        let statusText = b.textContent.trim();
                        if (statusText.toLowerCase().includes('loading')) statusText = 'Loading';
                        else if (statusText.toLowerCase().includes('searching')) statusText = 'Searching';
                        else if (statusText.toLowerCase().includes('process')) statusText = 'Processing';
                        return { text: statusText, id: b.id, class: b.className };
                    })
                    .filter((item, index, self) => index === self.findIndex((t) => t.text === item.text && t.class === item.class));
                const forms = Array.from(document.querySelectorAll('form')).map(f => ({
                    action: f.action,
                    method: f.method
                }));
                return { buttons, forms };
            });

            const dataToWrite = `Buttons:\n${JSON.stringify(data.buttons, null, 2)}\n\nForms:\n${JSON.stringify(data.forms, null, 2)}`;
            await fs.writeFile(path.join(accountDir, 'dailycheckin_data.txt'), dataToWrite, 'utf8');
            console.log(`Account ${accountId}: Data successfully saved to ${path.join(accountDir, 'dailycheckin_data.txt')}`);

            await browser.close();
            return;
        } catch (error) {
            console.error(`Account ${accountId} - Attempt ${attempt} failed: ${error.message}`);
            if (browser) await browser.close();
            if (attempt === maxRetries) {
                console.error(`Account ${accountId}: All attempts failed. Exiting...`);
            } else {
                await delay(2000);
            }
        }
    }
}

async function processToken() {
    const proxies = await getProxies();
    const tokenData = await getTokenData();

    for (const accountId in tokenData) {
        console.log(`Processing account: ${accountId}`);
        await processTokenWithRetry(proxies, accountId, tokenData[accountId]);
        await delay(5000);
    }
}

processToken();
