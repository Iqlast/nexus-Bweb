const fs = require('fs');
const axios = require('axios');
const { ethers } = require('ethers');

const WALLET_FILE = 'wallet.txt';
const PROXY_FILE = 'proxy.txt';
const PING_URL = 'https://rpc.nexus.xyz/http';
const AUTH_URL = 'https://app.dynamicauth.com/api/v0/sdk/adc09cea-6194-4667-8be8-931cc28dacd2/nonce';
const TASK_URL = 'https://beta.orchestrator.nexus.xyz/tasks';
const SUBMIT_URL = 'https://beta.orchestrator.nexus.xyz/tasks/submit';
const PING_INTERVAL = 30000; // 30 detik
const RECONNECT_INTERVAL = 2000; // 2 detik jika disconnect
const NEX_DECIMALS = 18; // Asumsi token NEX memiliki 18 desimal

let isDisconnected = {};
let useProxy = false;
let proxies = [];

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
        const proxyList = fs.readFileSync(PROXY_FILE, 'utf8').trim().split('\n');
        return proxyList.map(proxy => proxy.trim());
    } catch (error) {
        console.error('Error membaca proxy.txt:', error);
        return [];
    }
}

// Menyensor private key (5 karakter awal dan 3 karakter akhir)
function maskPrivateKey(privateKey) {
    if (!privateKey || privateKey.length < 8) return privateKey; // Jika private key terlalu pendek, tidak disensor
    const visibleStart = privateKey.slice(0, 5);
    const visibleEnd = privateKey.slice(-3);
    return `${visibleStart}*****${visibleEnd}`;
}

const wallets = getWallets();
proxies = getProxies();

console.log(`Menggunakan ${wallets.length} wallet:`);
wallets.forEach(wallet => console.log(`- (Private Key: ${maskPrivateKey(wallet.privateKey)})`));

// Memilih proxy secara random
function getRandomProxy() {
    if (proxies.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * proxies.length);
    return proxies[randomIndex];
}

// Fungsi untuk membuat instance axios dengan proxy
function createAxiosInstance(proxy) {
    if (!proxy) return axios;

    const proxyUrl = `http://${proxy}`;
    return axios.create({
        proxy: {
            protocol: 'http',
            host: proxy.split('@')[1].split(':')[0],
            port: parseInt(proxy.split(':')[2]),
            auth: {
                username: proxy.split('://')[1].split(':')[0],
                password: proxy.split(':')[1].split('@')[0]
            }
        }
    });
}

async function authenticate(wallet, axiosInstance) {
    try {
        const response = await axiosInstance.get(AUTH_URL, { headers: { 'x-dyn-api-version': 'API/0.0.599' } });
        console.log(`Autentikasi berhasil untuk (Private Key: ${maskPrivateKey(wallet.privateKey)})`);
        console.log('Respon Server:', response.data);
        return response.data;
    } catch (error) {
        console.error(`Gagal mendapatkan nonce untuk (Private Key: ${maskPrivateKey(wallet.privateKey)}):`, error.message);
        return null;
    }
}

async function sendPing(wallet, axiosInstance) {
    try {
        const response = await axiosInstance.post(PING_URL, {
            jsonrpc: '2.0',
            id: 58,
            method: 'eth_getBalance',
            params: [wallet.address, 'latest']
        });
        
        const balanceInWei = response.data.result;
        const balanceInNex = ethers.formatUnits(balanceInWei, NEX_DECIMALS);
        
        console.log(`Ping success untuk (Private Key: ${maskPrivateKey(wallet.privateKey)}): Balance NEX: ${balanceInNex}`);
        console.log('Respon Server:', response.data);
        isDisconnected[wallet.address] = false;
    } catch (error) {
        console.error(`Ping gagal untuk (Private Key: ${maskPrivateKey(wallet.privateKey)}), koneksi terputus!`);
        if (!isDisconnected[wallet.address]) {
            isDisconnected[wallet.address] = true;
            reconnect(wallet, axiosInstance);
        }
    }
}

async function reconnect(wallet, axiosInstance) {
    while (isDisconnected[wallet.address]) {
        console.log(`Mencoba menyambungkan kembali untuk (Private Key: ${maskPrivateKey(wallet.privateKey)})...`);
        const auth = await authenticate(wallet, axiosInstance);
        if (auth) {
            console.log(`Reconnected untuk (Private Key: ${maskPrivateKey(wallet.privateKey)})!`);
            isDisconnected[wallet.address] = false;
        } else {
            await new Promise(resolve => setTimeout(resolve, RECONNECT_INTERVAL));
        }
    }
}

async function getTask(wallet, axiosInstance) {
    try {
        const taskBody = fs.readFileSync('task.txt', 'utf8');
        const response = await axiosInstance.post(TASK_URL, taskBody, {
            headers: {
                'Host': 'beta.orchestrator.nexus.xyz',
                'Connection': 'keep-alive',
                'Content-Length': taskBody.length,
                'Reqable-Id': 'reqable-id-ceb26ab6-d378-4028-98f7-61775891c2aa',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'Content-Type': 'application/octet-stream',
                'Accept-Language': 'en-US,en;q=0.9',
                'Origin': 'https://app.nexus.xyz',
                'Referer': 'https://app.nexus.xyz/',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-site',
                'Sec-GPC': '1',
                'sec-ch-ua': '"Not(A:Brand";v="99", "Brave";v="133", "Chromium";v="133"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"'
            }
        });
        console.log(`Task berhasil didapatkan untuk (Private Key: ${maskPrivateKey(wallet.privateKey)})`);
        console.log('Respon Server:', response.data);
        return response.data;
    } catch (error) {
        console.error(`Gagal mendapatkan task untuk (Private Key: ${maskPrivateKey(wallet.privateKey)}):`, error.message);
        return null;
    }
}

async function submitTask(wallet, axiosInstance) {
    try {
        const submitBody = fs.readFileSync('submit.txt', 'utf8');
        const response = await axiosInstance.post(SUBMIT_URL, submitBody, {
            headers: {
                'Host': 'beta.orchestrator.nexus.xyz',
                'Connection': 'keep-alive',
                'Content-Length': submitBody.length,
                'Reqable-Id': 'reqable-id-659b3686-e6f3-416c-8ad0-c9f8ccc18bee',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'Content-Type': 'application/octet-stream',
                'Accept-Language': 'en-US,en;q=0.9',
                'Origin': 'https://app.nexus.xyz',
                'Referer': 'https://app.nexus.xyz/',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-site',
                'Sec-GPC': '1',
                'sec-ch-ua': '"Not(A:Brand";v="99", "Brave";v="133", "Chromium";v="133"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"'
            }
        });
        console.log(`Task berhasil disubmit untuk (Private Key: ${maskPrivateKey(wallet.privateKey)})`);
        console.log('Respon Server:', response.data);
        return response.data;
    } catch (error) {
        console.error(`Gagal submit task untuk (Private Key: ${maskPrivateKey(wallet.privateKey)}):`, error.message);
        return null;
    }
}

async function start() {
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    readline.question('Pilih mode:\n1. No Proxy\n2. With Proxy\nPilihan: ', async (choice) => {
        useProxy = choice === '2';
        readline.close();

        console.log('Memulai auto-ping ke Nexus.xyz...');
        for (const wallet of wallets) {
            const proxy = useProxy ? getRandomProxy() : null;
            const axiosInstance = createAxiosInstance(proxy);

            await authenticate(wallet, axiosInstance);
            setInterval(() => sendPing(wallet, axiosInstance), PING_INTERVAL);
            setInterval(async () => {
                const task = await getTask(wallet, axiosInstance);
                if (task) {
                    await submitTask(wallet, axiosInstance);
                }
            }, PING_INTERVAL);
        }
    });
}

start();
