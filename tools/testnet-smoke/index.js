const { ethers } = require('ethers');

const RPC_URL = process.env.TESTNET_RPC_URL;
const PRIVATE_KEY = process.env.TESTNET_PRIVATE_KEY;
const RETRIES = parseInt(process.env.SMOKE_RETRIES || '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.SMOKE_RETRY_DELAY_MS || '5000', 10);
const OP_TIMEOUT_MS = parseInt(process.env.SMOKE_OP_TIMEOUT_MS || '60000', 10);

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function withRetry(fn, desc) {
  let lastErr;
  for (let i = 0; i < RETRIES; i++) {
    try {
      const res = await Promise.race([
        fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), OP_TIMEOUT_MS)),
      ]);
      return res;
    } catch (err) {
      lastErr = err;
      console.error(`Attempt ${i + 1}/${RETRIES} failed for ${desc}: ${err.message}`);
      if (i < RETRIES - 1) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

async function run() {
  if (!RPC_URL || !PRIVATE_KEY) {
    console.error('Missing TESTNET_RPC_URL or TESTNET_PRIVATE_KEY environment variables.');
    process.exitCode = 2;
    return;
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log('Running Testnet smoke checks against', RPC_URL);

  // Read-only checks
  const blockNumber = await withRetry(() => provider.getBlockNumber(), 'getBlockNumber');
  console.log('Block number:', blockNumber);

  const balance = await withRetry(() => provider.getBalance(wallet.address), 'getBalance');
  console.log('Wallet address:', wallet.address);
  console.log('Wallet balance (wei):', balance.toString());

  // Safe state transition: send 0 ETH to self (nonce increment only)
  if (balance.isZero()) {
    console.error('Wallet balance is zero; cannot send transaction. Funding required.');
    process.exitCode = 3;
    return;
  }

  const tx = {
    to: wallet.address,
    value: ethers.constants.Zero,
    gasLimit: ethers.BigNumber.from(21000),
  };

  console.log('Sending 0 ETH transaction to self (safe state transition)');
  const sent = await withRetry(() => wallet.sendTransaction(tx), 'sendTransaction');
  console.log('Sent tx hash:', sent.hash);

  // Wait for confirmation deterministically
  const receipt = await withRetry(() => provider.waitForTransaction(sent.hash, 1, OP_TIMEOUT_MS), 'waitForTransaction');
  if (!receipt || receipt.status === 0) {
    console.error('Transaction failed or reverted');
    process.exitCode = 4;
    return;
  }

  console.log('Transaction confirmed in block', receipt.blockNumber);
  console.log('Smoke suite completed successfully');
}

run().catch((err) => {
  console.error('Unhandled error in smoke script:', err);
  process.exitCode = 1;
});
