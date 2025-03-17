const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

const proxyFile = 'proxy.txt';
const tokenFile = 'token.txt';
const credentialsFile = 'credentials.json';
const baseCheckinFile = 'last_checkin_time_';

// Output folder ဖန်တီးမယ်
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
        console.error(`Error reading proxy.txt: ${error.message}`);
        process.exit(1);
    }
}

async function getTokenData() {
    try {
        const data = await fs.readFile(tokenFile, 'utf8');
        const lines = data.split('\n').map(line => line.trim()).filter(line => line);
        const tokenData = {};
        for (const line of lines) {
            const [key, value] = line.split('=');
            if (key && value) tokenData[key] = value;
        }
        if (!tokenData.harborSession) {
            throw new Error('Missing harbor-session cookie in token.txt. Expected format: harborSession=your_cookie_value');
        }
        return tokenData;
    } catch (error) {
        console.error(`Error reading token.txt: ${error.message}`);
        process.exit(1);
    }
}

async function getCredentials() {
    try {
        const data = await fs.readFile(credentialsFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading credentials.json: ${error.message}`);
        process.exit(1);
    }
}

async function getLastCheckinTime(accountId) {
    const fileName = `${baseCheckinFile}${accountId}.txt`;
    try {
        const data = await fs.readFile(fileName, 'utf8');
        return parseInt(data, 10) || 0;
    } catch (error) {
        return 0; // ဖိုင်မရှိရင် 0 ပြန်ပေးမယ်
    }
}

async function setLastCheckinTime(accountId, timestamp) {
    const fileName = `${baseCheckinFile}${accountId}.txt`;
    await fs.writeFile(fileName, timestamp.toString(), 'utf8');
}

function getRandomProxy(proxies) {
    const randomIndex = Math.floor(Math.random() * proxies.length);
    return proxies[randomIndex];
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function processTokenWithRetry(proxies, account, maxRetries = 3) {
    let { harborSession } = await getTokenData();
    const { email, password, accountId } = account;
    const lastCheckinTime = await getLastCheckinTime(accountId);
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000; // 24 နာရီမှာ milliseconds

    // 24 နာရီမဖြစ်သေးရင် မစမ်းဖို့
    if (now - lastCheckinTime < twentyFourHours) {
        const timeLeft = twentyFourHours - (now - lastCheckinTime);
        const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        console.log(`Account ${accountId}: Daily check-in already completed. Please wait ${hoursLeft}h ${minutesLeft}m before next attempt.`);
        return;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const selectedProxy = getRandomProxy(proxies);
        console.log(`Account ${accountId} - Attempt ${attempt}/${maxRetries} - Using proxy: ${selectedProxy}`);

        let browser;
        try {
            const proxyParts = selectedProxy.replace('http://', '').split('@');
            let proxyServer, auth = '';
            if (proxyParts.length > 1) {
                auth = proxyParts[0];
                proxyServer = proxyParts[1];
            } else {
                proxyServer = proxyParts[0];
            }
            const proxyArg = auth ? `--proxy-server=${proxyServer}` : `--proxy-server=${proxyServer}`;
            const [username, pass] = auth ? auth.split(':') : [null, null];

            browser = await puppeteer.launch({
                headless: true,
                args: [proxyArg, '--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();

            // Set viewport to ensure 100% zoom level
            await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

            // Cookie ထည့်မယ်
            await page.setCookie({
                name: 'harbor-session',
                value: harborSession,
                domain: 'hub.beamable.network',
                path: '/',
                httpOnly: true,
                secure: true
            });

            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9,my;q=0.8',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Referer': 'https://hub.beamable.network/onboarding/login',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
            });

            if (username && pass) {
                await page.authenticate({ username, password: pass });
            }

            // Daily Check-in စာမျက်နှာကို သွားမယ်
            console.log(`Account ${accountId}: Navigating to daily check-in page with harbor-session token...`);
            await page.goto('https://hub.beamable.network/modules/dailycheckin', { waitUntil: 'networkidle2', timeout: 60000 });
            await delay(30000); // Wait for 30 seconds

            // Expand sidebar if collapsed
            await page.evaluate(() => {
                const sidebar = document.querySelector('.sidebar');
                if (sidebar && window.getComputedStyle(sidebar).width === '0px') {
                    const toggle = document.querySelector('.sidebar-toggle');
                    if (toggle) toggle.click();
                }
            });
            await delay(2000);

            // Wait for "Claim" button to be available
            await page.waitForFunction(() => {
                const buttons = document.querySelectorAll('button');
                return Array.from(buttons).some(button => 
                    button.textContent.trim().toLowerCase().includes('claim')
                );
            }, { timeout: 30000 });

            // လက်ရှိ URL ကို စစ်မယ်
            const currentUrl = page.url();
            console.log(`Account ${accountId}: Current URL: ${currentUrl}`);

            if (currentUrl.includes('/onboarding/login') || currentUrl.includes('/onboarding/confirm')) {
                console.log(`Account ${accountId}: Session expired. Attempting to re-authenticate...`);
                await page.goto('https://hub.beamable.network/onboarding/login', { waitUntil: 'networkidle2', timeout: 60000 });
                await delay(2000);

                // Login ပုံစံ ဖြည့်မယ်
                await page.type('input[type="email"]', email);
                await page.type('input[type="password"]', password);
                await page.click('button[type="submit"]');
                await delay(5000);

                // အသစ် cookie ကို ယူမယ်
                const cookies = await page.cookies();
                const newHarborSession = cookies.find(cookie => cookie.name === 'harbor-session')?.value;
                if (newHarborSession) {
                    harborSession = newHarborSession;
                    await fs.writeFile(tokenFile, `harborSession=${harborSession}`, 'utf8');
                    console.log(`Account ${accountId}: Cookie updated successfully with new harbor-session value.`);
                } else {
                    console.log(`Account ${accountId}: Failed to retrieve new harbor-session cookie. Manual verification may be required.`);
                }

                // ထပ်မံ Daily Check-in ကို သွားမယ်
                await page.goto('https://hub.beamable.network/modules/dailycheckin', { waitUntil: 'networkidle2', timeout: 60000 });
                await delay(30000);

                // Expand sidebar again
                await page.evaluate(() => {
                    const sidebar = document.querySelector('.sidebar');
                    if (sidebar && window.getComputedStyle(sidebar).width === '0px') {
                        const toggle = document.querySelector('.sidebar-toggle');
                        if (toggle) toggle.click();
                    }
                });
                await delay(2000);

                // Wait for "Claim" button again
                await page.waitForFunction(() => {
                    const buttons = document.querySelectorAll('button');
                    return Array.from(buttons).some(button => 
                        button.textContent.trim().toLowerCase().includes('claim')
                    );
                }, { timeout: 30000 });
            } else if (currentUrl.includes('/dashboard') || currentUrl.includes('/modules/dailycheckin')) {
                console.log(`Account ${accountId}: Successfully logged in or redirected to dashboard/daily check-in page.`);
            } else {
                console.log(`Account ${accountId}: Redirected to an unexpected page.`);
            }

            // "Claimed" ဒါမှမဟုတ် "Already Claimed" စာသားရှိမရှိ စစ်မယ်
            const pageText = await page.evaluate(() => document.body.innerText);
            if (pageText.toLowerCase().includes('claimed') || pageText.toLowerCase().includes('already claimed') || pageText.toLowerCase().includes('check-in complete')) {
                console.log(`Account ${accountId}: Daily check-in already completed. Updating last check-in time.`);
                await setLastCheckinTime(accountId, now);
            } else {
                // Target the parent "group" class and check its children for "Claim"
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

                    // Check for buttons inside the group
                    const buttons = await group.$$('button');
                    for (const button of buttons) {
                        // Get the text content including nested elements
                        const buttonText = await page.evaluate(el => {
                            return el.textContent.trim().toLowerCase();
                        }, button);

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

                            // Scroll to the button to ensure visibility
                            await page.evaluate((el) => {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, button);

                            // Check if button is clickable
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
                                    console.log(`Account ${accountId}: Claim successful. Updating last check-in time.`);
                                    await setLastCheckinTime(accountId, now);
                                    break;
                                } catch (clickError) {
                                    console.log(`Account ${accountId}: Click failed with error: ${clickError.message}, trying JavaScript click...`);
                                    await page.evaluate((el) => el.click(), button);
                                    await delay(3000);
                                    claimButtonFound = true;
                                    console.log(`Account ${accountId}: Claim successful via JavaScript click. Updating last check-in time.`);
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

            // Output folder ဖန်တီးပြီး ဖိုင်သိမ်းမယ်
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
                        return {
                            text: statusText,
                            id: b.id,
                            class: b.className
                        };
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
            console.log(`Account ${accountId}: Extracted Data:`, data);

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
    const accounts = await getCredentials();

    for (const account of accounts) {
        console.log(`Processing account: ${account.accountId}`);
        await processTokenWithRetry(proxies, account);
        await delay(5000); // အကောင့်တစ်ခုချင်းစီကြား 5 စက္ကန့် စောင့်မယ်
    }
}

processToken();
