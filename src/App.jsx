import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { QRCodeCanvas } from "qrcode.react";

const STORAGE_KEY = "wallet_encrypted_v1";

// 🔴 PUT YOUR RPC HERE (FREE from alchemy.com)
const RPC_URL = "https://eth.llamarpc.com"; 
// public free rpc for now

export default function App() {
  const [tgUser, setTgUser] = useState(null);
  const [password, setPassword] = useState("");
  const [wallet, setWallet] = useState(null);
  const [seedPhrase, setSeedPhrase] = useState("");
  const [status, setStatus] = useState("");
  const [ethBalance, setEthBalance] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    const tg = window?.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      setTgUser(tg.initDataUnsafe?.user || null);
    }
  }, []);

  const address = useMemo(() => wallet?.address || "", [wallet]);

  // 🔵 CREATE WALLET
  async function createNewWallet() {
    try {
      setStatus("");
      if (!password || password.length < 6) {
        setStatus("Password must be at least 6 characters.");
        return;
      }

      const w = ethers.Wallet.createRandom();
      setSeedPhrase(w.mnemonic?.phrase || "");

      const encrypted = await w.encrypt(password);
      localStorage.setItem(STORAGE_KEY, encrypted);

      setWallet(w);
      setStatus("Wallet created and saved.");
      setTimeout(refreshBalance, 800);
    } catch (e) {
      setStatus("Error: " + e.message);
    }
  }

  // 🔵 UNLOCK WALLET
  async function unlockWallet() {
    try {
      setStatus("");
      const encrypted = localStorage.getItem(STORAGE_KEY);
      if (!encrypted) {
        setStatus("No wallet saved.");
        return;
      }

      const w = await ethers.Wallet.fromEncryptedJson(encrypted, password);
      setWallet(w);
      setSeedPhrase("");
      setStatus("Wallet unlocked.");
      setTimeout(refreshBalance, 500);
    } catch {
      setStatus("Wrong password.");
    }
  }

  // 🔵 DELETE WALLET
  function deleteWallet() {
    localStorage.removeItem(STORAGE_KEY);
    setWallet(null);
    setSeedPhrase("");
    setStatus("Wallet deleted.");
  }

  // 🔵 GET BALANCE
  async function refreshBalance() {
    try {
      if (!wallet) return;
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const bal = await provider.getBalance(wallet.address);
      setEthBalance(ethers.formatEther(bal));
    } catch (e) {
      setStatus("Balance error");
    }
  }

  // 🔵 SEND ETH
  async function sendEth() {
    try {
      if (!to || !amount) {
        setStatus("Enter address + amount");
        return;
      }

      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const signer = wallet.connect(provider);

      setStatus("Sending...");
      const tx = await signer.sendTransaction({
        to,
        value: ethers.parseEther(amount),
      });

      setStatus("Transaction sent: " + tx.hash);
      await tx.wait();

      setStatus("Confirmed: " + tx.hash);
      refreshBalance();
    } catch (e) {
      setStatus("Send failed");
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial", maxWidth: 500 }}>
      <h2>Telegram Crypto Wallet</h2>

      <div style={{ marginBottom: 10 }}>
        User: {tgUser ? tgUser.first_name : "Browser mode"}
      </div>

      {!wallet && (
        <>
          <input
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: 10, width: "100%", marginBottom: 10 }}
          />

          <button onClick={createNewWallet} style={{ padding: 10, width: "100%", marginBottom: 10 }}>
            Create Wallet
          </button>

          <button onClick={unlockWallet} style={{ padding: 10, width: "100%" }}>
            Unlock Wallet
          </button>

          {seedPhrase && (
            <div style={{ marginTop: 20, background: "#000", color: "#0f0", padding: 15 }}>
              <b>WRITE THIS SEED DOWN:</b>
              <div>{seedPhrase}</div>
            </div>
          )}
        </>
      )}

      {wallet && (
        <>
          <h3>Your Address</h3>
          <div style={{ wordBreak: "break-all" }}>{address}</div>

          <div style={{ marginTop: 15 }}>
            <QRCodeCanvas value={address} size={180} />
          </div>

          <div style={{ marginTop: 15 }}>
            Balance: {ethBalance} ETH
          </div>

          <button onClick={refreshBalance} style={{ padding: 10, width: "100%", marginTop: 10 }}>
            Refresh Balance
          </button>

          <h3 style={{ marginTop: 20 }}>Send ETH</h3>

          <input
            placeholder="To address"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ padding: 10, width: "100%", marginBottom: 10 }}
          />

          <input
            placeholder="Amount ETH"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ padding: 10, width: "100%", marginBottom: 10 }}
          />

          <button onClick={sendEth} style={{ padding: 12, width: "100%", background: "black", color: "white" }}>
            Send
          </button>

          <button onClick={deleteWallet} style={{ padding: 10, width: "100%", marginTop: 15 }}>
            Delete Wallet
          </button>
        </>
      )}

      <div style={{ marginTop: 20 }}>{status}</div>
    </div>
  );
}
