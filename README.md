# Beamable Daily claim

## Register
- [Beamable Register](https://hub.beamable.network/ref/S65QUP4F)

- ## Installation

1. Clone the repository:
```
git clone https://github.com/airdropbomb/beamable.git
cd beamable
```

2. Install the required packages:
```
npm install
```

## Setup

3. Open `token.txt` file in the same directory as the script with one token per line:
```
account1=harborSession=yourcookies
account2=harborSession=yourcookies
account3=harborSession=yourcookies
```
## How to get cookies?
login beamable web then F12 or inspect element and go to Application Click the Cookies Section and copy your cookies in the harbor-session.

4. (Optional) Open `proxies.txt` file with one proxy per line
```
127.0.0.1:8080
http://proxy.example.com:8080
socks5://127.0.0.1:1080
```

5. Run the bot:
```
node index.js
```
