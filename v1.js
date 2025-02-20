const fs = require('fs');
const axios = require('axios');
const { ethers } = require('ethers');
const { HttpsProxyAgent } = require('https-proxy-agent');

const WALLET_FILE = 'wallet.txt';
const PROXY_FILE = 'proxy.txt';
const PING_URL = 'https://rpc.nexus.xyz/http';
const AUTH_URL = 'https://app.dynamicauth.com/api/v0/sdk/adc09cea-6194-4667-8be8-931cc28dacd2/nonce';
const PING_INTERVAL = 30000; // 30 detik
const RECONNECT_INTERVAL = 2000; // 2 detik jika disconnect
const NEX_DECIMALS = 18; // Asumsi token NEX memiliki 18 desimal

let isDisconnected = {};

// Membaca wallet dari file
function getWallets() {
    try {
        const privateKeys = fs.readFileSync(WALLET_FILE, 'utf8').trim().split('\n');
        return privateKeys.map(key => new ethers.Wallet(key.trim()));
    } catch (error) {
        console.error('Error membaca wallet.txt:', error);
        process.exit(1);
    }
}

// Membaca proxy dari file
function getProxies() {
    try {
        return fs.readFileSync(PROXY_FILE, 'utf8').trim().split('\n');
    } catch (error) {
        console.error('Error membaca proxy.txt:', error);
        return [];
    }
}

const wallets = getWallets();
const proxies = getProxies();

console.log(`Menggunakan ${wallets.length} wallet:`);
wallets.forEach(wallet => console.log(`- ${wallet.address}`));

async function authenticate(wallet, proxy) {
    try {
        const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
        const response = await axios.get(AUTH_URL, { 
            headers: { 'x-dyn-api-version': 'API/0.0.599' },
            httpsAgent: agent
        });
        console.log(`Autentikasi berhasil untuk ${wallet.address} dengan proxy ${proxy || 'tanpa proxy'}`);
        console.log('Respon Server:', response.data);
        return response.data;
    } catch (error) {
        console.error(`Gagal mendapatkan nonce untuk ${wallet.address} dengan proxy ${proxy || 'tanpa proxy'}:`, error.message);
        return null;
    }
}

async function testProxy(proxy) {
    try {
        const agent = new HttpsProxyAgent(proxy);
        await axios.get('https://www.google.com', { httpsAgent: agent });
        console.log(`Proxy berhasil digunakan: ${proxy}`);
        return true;
    } catch (error) {
        console.error(`Proxy gagal: ${proxy}, error:`, error.message);
        return false;
    }
}

async function findWorkingProxy() {
    for (let proxy of proxies) {
        if (await testProxy(proxy)) {
            return proxy;
        }
    }
    return null;
}

async function sendPing(wallet) {
    let proxy = await findWorkingProxy();
    if (!proxy) {
        console.log(`Tidak ada proxy yang berhasil untuk ${wallet.address}, mencoba tanpa proxy.`);
        proxy = null;
    }

    try {
        const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
        const response = await axios.post(PING_URL, {
            jsonrpc: '2.0',
            id: 58,
            method: 'eth_getBalance',
            params: [wallet.address, 'latest']
        }, { httpsAgent: agent });
        
        const balanceInWei = response.data.result;
        const balanceInNex = ethers.formatUnits(balanceInWei, NEX_DECIMALS);
        console.log(`Ping success untuk ${wallet.address} ${proxy ? `dengan proxy ${proxy}` : 'tanpa proxy'}: Balance NEX: ${balanceInNex}`);
        console.log('Respon Server:', response.data);
        
        isDisconnected[wallet.address] = false;
    } catch (error) {
        console.error(`Ping gagal untuk ${wallet.address} ${proxy ? `dengan proxy ${proxy}` : 'tanpa proxy'}, koneksi terputus!`);
        if (!isDisconnected[wallet.address]) {
            isDisconnected[wallet.address] = true;
            sendPing(wallet); // Coba ulang tanpa proxy
        }
    }
}

async function start() {
    console.log('Memulai auto-ping ke Nexus.xyz...');
    for (let wallet of wallets) {
        setInterval(() => sendPing(wallet), PING_INTERVAL);
    }
}

start();

