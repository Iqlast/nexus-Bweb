const fs = require('fs');
const axios = require('axios');
const { ethers } = require('ethers');

const WALLET_FILE = 'wallet.txt';
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

const wallets = getWallets();
console.log(`Menggunakan ${wallets.length} wallet:`);
wallets.forEach(wallet => console.log(`- ${wallet.address}`));

async function authenticate(wallet) {
    try {
        const response = await axios.get(AUTH_URL, { headers: { 'x-dyn-api-version': 'API/0.0.599' } });
        console.log(`Autentikasi berhasil untuk ${wallet.address}`);
        console.log('Respon Server:', response.status, response.statusText, response.data);
        return response.data;
    } catch (error) {
        console.error(`Gagal mendapatkan nonce untuk ${wallet.address}:`, error.message);
        return null;
    }
}

async function sendPing(wallet) {
    try {
        const response = await axios.post(PING_URL, {
            jsonrpc: '2.0',
            id: 58,
            method: 'eth_getBalance',
            params: [wallet.address, 'latest']
        });
        
        const balanceInWei = response.data.result;
        const balanceInNex = ethers.formatUnits(balanceInWei, NEX_DECIMALS);
        
        console.log(`Ping success untuk ${wallet.address}: Balance NEX: ${balanceInNex}`);
        console.log('Respon Server:', response.status, response.statusText, response.data);
        isDisconnected[wallet.address] = false;
    } catch (error) {
        console.error(`Ping gagal untuk ${wallet.address}, koneksi terputus!`);
        if (!isDisconnected[wallet.address]) {
            isDisconnected[wallet.address] = true;
            reconnect(wallet);
        }
    }
}

async function reconnect(wallet) {
    while (isDisconnected[wallet.address]) {
        console.log(`Mencoba menyambungkan kembali untuk ${wallet.address}...`);
        const auth = await authenticate(wallet);
        if (auth) {
            console.log(`Reconnected untuk ${wallet.address}!`);
            isDisconnected[wallet.address] = false;
        } else {
            await new Promise(resolve => setTimeout(resolve, RECONNECT_INTERVAL));
        }
    }
}

async function start() {
    console.log('Memulai auto-ping ke Nexus.xyz...');
    for (const wallet of wallets) {
        await authenticate(wallet);
        setInterval(() => sendPing(wallet), PING_INTERVAL);
    }
}

start();
