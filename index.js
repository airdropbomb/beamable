console.log(`
 █████╗ ██████╗ ██████╗     ███╗   ██╗ ██████╗ ██████╗ ███████╗
██╔══██╗██╔══██╗██╔══██╗    ████╗  ██║██╔═══██╗██╔══██╗██╔════╝
███████║██║  ██║██████╔╝    ██╔██╗ ██║██║   ██║██║  ██║█████╗  
██╔══██║██║  ██║██╔══██╗    ██║╚██╗██║██║   ██║██║  ██║██╔══╝  
██║  ██║██████╔╝██████╔╝    ██║ ╚████║╚██████╔╝██████╔╝███████╗
╚═╝  ╚═╝╚═════╝ ╚═════╝     ╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚══════╝
by btctrader
`);

const puppeteer = require('puppeteer');
const fetch = require('node-fetch');
const HttpsProxyAgent = require('https-proxy-agent');
const fs = require('fs').promises;
const path = require('path');

const proxyFile = 'proxy.txt';
const tokenFile = 'token.txt';
const baseCheckinFile = 'last_checkin_time_';
const outputDir = 'output';
const checkinDir = 'last_checkins';

// Default headers for fetch requests
const defaultHeaders = {
    "accept": "text/x-component",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "text/plain;charset=UTF-8",
    "sec-ch-ua": "\"Chromium\";v=\"134\", \"Not:A-Brand\";v=\"24\", \"Google Chrome\";v=\"134\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "Referer": "https://hub.beamable.network/modules/aprildailies",
    "Referrer-Policy": "strict-origin-when-cross-origin"
};

async function ensureOutputDir(accountId) {
    const accountDir = path.join(outputDir, accountId);
    await fs.mkdir(accountDir, { recursive: true });
    return accountDir;
}

async function ensureCheckinDir() {
    const checkinFolder = path.join(checkinDir);
    await fs.mkdir(checkinFolder, { recursive: true });
    return checkinFolder;
}

async function getProxies() {
    try {
        const data = await fs.readFile(proxyFile, 'utf8');
        const proxies = data.split('\n').map(line => line.trim()).filter(line => line);
        if (proxies.length === 0) throw new Error('No proxies found');
        return proxies;
    } catch (error) {
        console.log(`No proxy file found: ${error.message}. Proceeding without proxy.`);
        return null;
    }
}

async function getTokenData() {
    try {
        const data = await fs.readFile(tokenFile, 'utf8');
        const lines = data.split('\n').map(line => line.trim()).filter(line => line);
        const tokenData = {};
        for (const line of lines) {
            const parts = line.split('=');
            if (parts.length < 3 || parts[1] !== 'harborSession') continue;
            const accountId = parts[0];
            const value = parts.slice(2).join('=');
            tokenData[accountId] = value;
        }
        if (Object.keys(tokenData).length === 0) throw new Error('No valid harbor-session cookies found');
        return tokenData;
    } catch (error) {
        console.error(`Error reading token.txt: ${error.message}`);
        process.exit(1);
    }
}

async function getLastCheckinTime(accountId) {
    const checkinFolder = await ensureCheckinDir();
    const fileName = path.join(checkinFolder, `${baseCheckinFile}${accountId}.txt`);
    try {
        const data = await fs.readFile(fileName, 'utf8');
        return parseInt(data, 10) || 0;
    } catch (error) {
        return 0;
    }
}

async function setLastCheckinTime(accountId, timestamp) {
    const checkinFolder = await ensureCheckinDir();
    const fileName = path.join(checkinFolder, `${baseCheckinFile}${accountId}.txt`);
    await fs.writeFile(fileName, timestamp.toString(), 'utf8');
}

function getRandomProxy(proxies) {
    if (!proxies) return null;
    const randomIndex = Math.floor(Math.random() * proxies.length);
    return proxies[randomIndex];
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch nonce from the page
async function getNonce(cookie, agent) {
    try {
        const url = 'https://hub.beamable.network/modules/aprildailies';
        const headers = { ...defaultHeaders, "Cookie": cookie };
        const request = await fetch(url, {
            method: 'GET',
            headers,
            agent,
        });

        const response = await request.text();
        const text = response.slice(-400000);
        const cleanedText = text.replace(/\\"/g, '"');
        const regex = /"nonce":"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"/;
        const match = cleanedText.match(regex);

        if (match) {
            console.log(`Nonce retrieved: ${match[1]}`);
            return match[1];
        } else {
            throw new Error('Nonce not found in response');
        }
    } catch (error) {
        console.error(`Error getting nonce: ${error.message}`);
        return null;
    }
}

// Perform daily check-in using fetch
async function dailyCheckIn(cookie, agent) {
    try {
        const nonce = await getNonce(cookie, agent);
        if (!nonce) throw new Error('Failed to retrieve nonce');

        const headers = {
            ...defaultHeaders,
            "Cookie": cookie,
            "next-action": "7fb84504b1af6fa4a015452e147da5ba17d2d03551",
            "next-router-state-tree": "%5B%22%22%2C%7B%22children%22%3A%5B%5B%22host%22%2C%22hub.beamable.network%22%2C%22d%22%5D%2C%7B%22children%22%3A%5B%22modules%22%2C%7B%22children%22%3A%5B%5B%22moduleIdOrPath%22%2C%22aprildailies%22%2C%22d%22%5D%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2C%22%2Fmodules%2Faprildailies%22%2C%22refresh%22%5D%7D%5D%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D",
            "priority": "u=1, i"
        };

        const response = await fetch("https://hub.beamable.network/modules/aprildailies", {
            headers,
            body: `[467,"${nonce}","aprildailies"]`,
            method: "POST",
            agent
        });

        if (response.ok) {
            console.log("Daily check-in successful");
            return true;
        } else {
            throw new Error(`Check-in failed with status: ${response.status}`);
        }
    } catch (error) {
        console.error(`Error during daily check-in: ${error.message}`);
        return false;
    }
}

async function processTokenWithRetry(proxies, accountId, harborSession, maxRetries = 3) {
    const lastCheckinTime = await getLastCheckinTime(accountId);
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    if (now - lastCheckinTime < twentyFourHours) {
        const timeLeft = twentyFourHours - (now - lastCheckinTime);
        const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        console.log(`Account ${accountId}: Daily check-in already completed. Wait ${hoursLeft}h ${minutesLeft}m`);
        return false;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const selectedProxy = getRandomProxy(proxies);
        console.log(`Account ${accountId} - Attempt ${attempt}/${maxRetries} ${selectedProxy ? `- Proxy: ${selectedProxy}` : '- No proxy'}`);

        let browser, agent = null;
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
                agent = new HttpsProxyAgent(selectedProxy);
                var [username, pass] = auth ? auth.split(':') : [null, null];
            }

            browser = await puppeteer.launch({ headless: true, args: launchArgs });
            const page = await browser.newPage();

            await page.setCookie({
                name: 'harbor-session',
                value: harborSession,
                domain: 'hub.beamable.network',
                path: '/',
                httpOnly: true,
                secure: true
            });

            await page.goto('https://hub.beamable.network/modules/aprildailies', { waitUntil: 'networkidle2', timeout: 60000 });

            if (username && pass) await page.authenticate({ username, password: pass });

            const currentUrl = page.url();
            if (currentUrl.includes('/onboarding/login')) {
                console.log(`AccountTREEsession expired. Update harborSession in token.txt`);
                await browser.close();
                return false;
            }

            // Perform daily check-in using fetch
            const checkInSuccess = await dailyCheckIn(harborSession, agent);
            if (checkInSuccess) {
                await setLastCheckinTime(accountId, now);
                console.log(`Account ${accountId}: Check-in completed and timestamp updated`);
            } else {
                console.log(`Account ${accountId}: Check-in failed`);
            }

            const accountDir = await ensureOutputDir(accountId);
            const content = await page.content();
            await fs.writeFile(path.join(accountDir, 'dailycheckin_page.html'), content, 'utf8');
            const dataToSave = `Account: ${accountId}\nLast Check-in: ${new Date(now).toLocaleString()}\nStatus: ${checkInSuccess ? 'Claimed' : 'Not Claimed'}\n`;
            await fs.writeFile(path.join(accountDir, 'dailycheckin_data.txt'), dataToSave, 'utf8');

            await browser.close();
            return checkInSuccess;
        } catch (error) {
            console.error(`Account ${accountId}: Error on attempt ${attempt}: ${error.message}`);
            if (browser) await browser.close();
            if (attempt === maxRetries) {
                console.log(`Account ${accountId}: Max retries reached`);
                return false;
            }
            await delay(5000);
        }
    }
    return false;
}

async function main() {
    const proxies = await getProxies();
    const tokenData = await getTokenData();

    for (const [accountId, harborSession] of Object.entries(tokenData)) {
        console.log(`Processing account: ${accountId}`);
        const success = await processTokenWithRetry(proxies, accountId, harborSession);
        if (!success) {
            console.log(`Account ${accountId}: Failed or no action taken`);
        }
    }

    console.log('All accounts processed. Waiting 24 hours...');
    await delay(24 * 60 * 60 * 1000);
    await main();
}

main().catch(error => {
    console.error(`Main process error: ${error.message}`);
    process.exit(1);
});
