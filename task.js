console.log(`
 █████╗ ██████╗ ██████╗     ███╗   ██╗ ██████╗ ██████╗ ███████╗
██╔══██╗██╔══██╗██╔══██╗    ████╗  ██║██╔═══██╗██╔══██╗██╔════╝
███████║██║  ██║██████╔╝    ██╔██╗ ██║██║   ██║██║  ██║█████╗  
██╔══██║██║  ██║██╔══██╗    ██║╚██╗██║██║   ██║██║  ██║██╔══╝  
██║  ██║██████╔╝██████╔╝    ██║ ╚████║╚██████╔╝██████╔╝███████╗
╚═╝  ╚═╝╚═════╝ ╚═════╝     ╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚══════╝
by btctrader
`);

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');

// Use the stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

const tokenFile = 'token.txt';

// Read token data from token.txt
async function getTokenData() {
    try {
        const data = await fs.readFile(tokenFile, 'utf8');
        const lines = data.split('\n').map(line => line.trim()).filter(line => line);
        const tokenData = {};

        for (const line of lines) {
            const parts = line.split('=');
            if (parts.length < 3) {
                console.error(`Invalid line format (not enough parts): ${line}`);
                continue;
            }
            const accountId = parts[0];
            const key = parts[1];
            const value = parts.slice(2).join('=');

            if (key === 'harborSession') {
                tokenData[accountId] = value;
                const maskedValue = value.substring(0, 5) + '****' + value.substring(value.length - 5);
                console.log(`Account ${accountId}: Cookie loaded - ${maskedValue}`);
            } else {
                console.error(`Account ${accountId}: Invalid key (expected harborSession, got ${key})`);
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

// Random delay to mimic human behavior
const randomDelay = (min, max) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
};

// Simulate human-like mouse movement
async function simulateMouseMovement(page) {
    const width = 1280;
    const height = 720;
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    await page.mouse.move(x, y, { steps: 10 });
    await randomDelay(500, 1500);
}

// Simulate human-like scrolling
async function simulateScrolling(page) {
    await page.evaluate(async () => {
        await new Promise(resolve => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
    await randomDelay(1000, 2000);
}

// Simulate human-like keyboard usage
async function simulateKeyboardUsage(page) {
    await page.keyboard.press('ArrowDown');
    await randomDelay(500, 1000);
    await page.keyboard.press('ArrowUp');
    await randomDelay(500, 1000);
}

// Process a single account with retries
async function processTokenWithRetry(accountId, harborSession, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`Account ${accountId} - Attempt ${attempt}/${maxRetries}`);

        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--window-size=1280,720',
                ],
                timeout: 60000
            });
            const page = await browser.newPage();

            await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

            console.log(`Account ${accountId}: Setting cookie...`);
            await page.setCookie({
                name: 'harbor-session',
                value: harborSession,
                domain: 'hub.beamable.network',
                path: '/',
                httpOnly: true,
                secure: true
            });

            console.log(`Account ${accountId}: Navigating to Profile page...`);
            await page.goto('https://hub.beamable.network/modules/profile/5456', { waitUntil: 'networkidle2', timeout: 180000 });

            await randomDelay(5000, 8000);
            await simulateMouseMovement(page);
            await simulateScrolling(page);
            await simulateKeyboardUsage(page);

            let currentUrl = page.url();
            console.log(`Account ${accountId}: Current URL: ${currentUrl}`);

            if (currentUrl.includes('/onboarding/login') || currentUrl.includes('/onboarding/confirm')) {
                console.log(`Account ${accountId}: Session expired. Please update harborSession cookie manually in token.txt using login link from email.`);
                await browser.close();
                return false;
            }

            console.log(`Account ${accountId}: Processing Open Amount...`);

            try {
                // Wait for network idle to ensure the page is fully loaded
                await page.waitForNetworkIdle({ timeout: 60000, idleTime: 1000 }).catch(() => {
                    console.log(`Account ${accountId}: Network idle wait timed out, proceeding anyway...`);
                });

                // Wait for the "BMB Box" text to ensure the relevant section is loaded
                await page.waitForFunction(() => document.body.innerText.includes('BMB Box'), { timeout: 60000 })
                    .catch(async () => {
                        console.log(`Account ${accountId}: "BMB Box" text not found on page. Saving debug info...`);
                        await page.screenshot({ path: `error_${accountId}_bmb_box.png` });
                        const html = await page.content();
                        await fs.writeFile(`error_${accountId}_bmb_box.html`, html);
                        throw new Error('"BMB Box" text not found');
                    });

                // Get the quantity of BMB Boxes
                let quantity = 0;
                try {
                    quantity = await page.evaluate(() => {
                        const quantityElement = Array.from(document.querySelectorAll('div')).find(el => el.innerText.includes('Quantity:'));
                        if (quantityElement) {
                            const match = quantityElement.innerText.match(/Quantity:\s*(\d+)/);
                            return match ? parseInt(match[1], 10) : 0;
                        }
                        return 0;
                    });
                    console.log(`Account ${accountId}: Found quantity: ${quantity}`);
                } catch (error) {
                    console.log(`Account ${accountId}: Failed to find quantity: ${error.message}`);
                    throw new Error('Could not determine the quantity of BMB Boxes');
                }

                if (quantity === 0) {
                    console.log(`Account ${accountId}: No BMB Boxes available to open. Skipping...`);
                    await browser.close();
                    return true; // Treat as success since there are no boxes to open
                }

                // Find the "Open Amount" input element
                let inputElement = null;
                const maxElementRetries = 3;
                for (let elementAttempt = 1; elementAttempt <= maxElementRetries; elementAttempt++) {
                    console.log(`Account ${accountId}: Attempt ${elementAttempt}/${maxElementRetries} to find Open Amount input...`);
                    try {
                        inputElement = await page.waitForSelector('input[type="number"].btn-primary.max-w-24', { timeout: 40000 });
                        console.log(`Account ${accountId}: Found Open Amount input.`);
                        break;
                    } catch (error) {
                        console.log(`Account ${accountId}: Open Amount input not found on attempt ${elementAttempt}: ${error.message}`);
                        if (elementAttempt === maxElementRetries) {
                            console.log(`Account ${accountId}: Refreshing page to try loading the element...`);
                            await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
                            await randomDelay(5000, 10000);
                            await simulateScrolling(page);
                            try {
                                inputElement = await page.waitForSelector('input[type="number"].btn-primary.max-w-24', { timeout: 40000 });
                                console.log(`Account ${accountId}: Found Open Amount input after page refresh.`);
                                break;
                            } catch (refreshError) {
                                console.log(`Account ${accountId}: Open Amount input still not found after refresh: ${refreshError.message}`);
                                await page.screenshot({ path: `error_${accountId}_input.png` });
                                const html = await page.content();
                                await fs.writeFile(`error_${accountId}_input.html`, html);
                                throw new Error('Open Amount input not found after maximum retries and page refresh');
                            }
                        }
                        await randomDelay(5000, 10000);
                    }
                }

                // Ensure the input element is interactable
                await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), inputElement);
                const isInputVisible = await page.evaluate(el => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                }, inputElement);
                if (!isInputVisible) {
                    throw new Error('Open Amount input is not visible');
                }

                // Simulate human-like interaction with the input
                await simulateMouseMovement(page);
                await page.evaluate(el => {
                    el.dispatchEvent(new Event('mouseover', { bubbles: true }));
                    el.dispatchEvent(new Event('focus', { bubbles: true }));
                }, inputElement);
                await inputElement.click();
                console.log(`Account ${accountId}: Clicked on the Open Amount input field.`);

                // Set the input field to the quantity
                await page.evaluate((qty) => {
                    const input = document.querySelector('input[type="number"].btn-primary.max-w-24');
                    if (input) {
                        const maxValue = input.getAttribute('max') || 999999;
                        input.value = Math.min(qty, parseInt(maxValue, 10));
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    } else {
                        throw new Error('Open Amount input field not found after retries');
                    }
                }, quantity);

                console.log(`Account ${accountId}: Set Open Amount to ${quantity}.`);

                // Find the "Open" button
                let buttonElement = null;
                for (let elementAttempt = 1; elementAttempt <= maxElementRetries; elementAttempt++) {
                    console.log(`Account ${accountId}: Attempt ${elementAttempt}/${maxElementRetries} to find Open button...`);
                    try {
                        buttonElement = await page.waitForSelector('div.opacity-100.bg-black\\/50.h3.rounded-full.text-center.py-5.px-10.flex.gap-2.items-center.cursor-pointer', { timeout: 50000 });
                        console.log(`Account ${accountId}: Found Open button.`);
                        break;
                    } catch (error) {
                        console.log(`Account ${accountId}: Open button not found on attempt ${elementAttempt}: ${error.message}`);
                        if (elementAttempt === maxElementRetries) {
                            await page.screenshot({ path: `error_${accountId}_button.png` });
                            const html = await page.content();
                            await fs.writeFile(`error_${accountId}_button.html`, html);
                            throw new Error('Open button not found after maximum retries');
                        }
                        await randomDelay(5000, 10000);
                    }
                }

                // Ensure the button is interactable
                await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), buttonElement);
                const isButtonVisible = await page.evaluate(el => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                }, buttonElement);
                if (!isButtonVisible) {
                    throw new Error('Open button is not visible');
                }

                // Simulate human-like interaction with the button
                await simulateMouseMovement(page);
                await page.evaluate(el => {
                    const events = ['mouseover', 'mousedown', 'mouseup', 'click'];
                    events.forEach(eventType => {
                        const event = new Event(eventType, { bubbles: true });
                        el.dispatchEvent(event);
                    });
                }, buttonElement);

                console.log(`Account ${accountId}: Clicked the Open button.`);

                // Wait for the action to complete by checking for quantity update
                let newQuantity = quantity;
                let quantityCheckAttempts = 0;
                const maxQuantityCheckAttempts = 10;
                while (quantityCheckAttempts < maxQuantityCheckAttempts) {
                    await randomDelay(2000, 4000);
                    newQuantity = await page.evaluate(() => {
                        const quantityElement = Array.from(document.querySelectorAll('div')).find(el => el.innerText.includes('Quantity:'));
                        if (quantityElement) {
                            const match = quantityElement.innerText.match(/Quantity:\s*(\d+)/);
                            return match ? parseInt(match[1], 10) : 0;
                        }
                        return 0;
                    });

                    if (newQuantity < quantity) {
                        console.log(`Account ${accountId}: Action confirmed - quantity decreased from ${quantity} to ${newQuantity}.`);
                        break;
                    }

                    quantityCheckAttempts++;
                    console.log(`Account ${accountId}: Quantity check attempt ${quantityCheckAttempts}/${maxQuantityCheckAttempts} - quantity still ${newQuantity}.`);
                }

                if (newQuantity >= quantity) {
                    console.log(`Account ${accountId}: Action did not register - quantity did not decrease (still ${newQuantity}). Saving debug info...`);
                    await page.screenshot({ path: `error_${accountId}_action.png` });
                    const html = await page.content();
                    await fs.writeFile(`error_${accountId}_action.html`, html);
                    throw new Error('Action did not register on the server');
                }

                console.log(`Account ${accountId}: Successfully completed actions. Quantity reduced to ${newQuantity}.`);
                await browser.close();
                return true;

            } catch (error) {
                console.error(`Account ${accountId}: Error during automation: ${error.message}`);
                await browser.close();
                return false;
            }
        } catch (error) {
            console.error(`Account ${accountId} - Attempt ${attempt} failed: ${error.message}`);
            if (browser) await browser.close();
            if (attempt === maxRetries) {
                console.error(`Account ${accountId}: Max retries reached. Pausing for 1 hour...`);
                await randomDelay(3600000, 3660000);
                return false;
            }
            await randomDelay(10000, 15000);
        }
    }
    return false;
}

// Main function to process all accounts
async function processToken() {
    const tokenData = await getTokenData();

    for (const accountId in tokenData) {
        console.log(`Processing account: ${accountId}`);
        const success = await processTokenWithRetry(accountId, tokenData[accountId]);
        if (success) {
            console.log(`Account ${accountId}: Successfully processed.`);
        } else {
            console.log(`Account ${accountId}: Failed to process.`);
        }
        await randomDelay(10000, 20000);
    }

    console.log(`All accounts processed. Script completed.`);
}

// Start the script
processToken().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
});
