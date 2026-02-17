import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { QRCodeCanvas } from "qrcode.react";

const STORAGE_KEY = "wallet_encrypted_v1";

// Public RPCs (good enough for learning / demo).
// For production, switch to Alchemy/Infura/QuickNode with your own keys.
const NETWORKS = [
  {
    key: "eth",
    name: "Ethereum",
    symbol: "ETH",
    chainId: 1,
    rpcUrl: "https://eth.llamarpc.com",
    explorerTx: (hash) => `https://etherscan.io/tx/${hash}`,
    explorerAddr: (addr) => `https://etherscan.io/address/${addr}`,
  },
  {
    key: "bsc",
    name: "BNB Chain",
    symbol: "BNB",
    chainId: 56,
    rpcUrl: "https://bsc-dataseed.binance.org",
    explorerTx: (hash) => `https://bscscan.com/tx/${hash}`,
    explorerAddr: (addr) => `https://bscscan.com/address/${addr}`,
  },
  {
    key: "polygon",
    name: "Polygon",
    symbol: "MATIC",
    chainId: 137,
    rpcUrl: "https://polygon-rpc.com",
    explorerTx: (hash) => `https://polygonscan.com/tx/${hash}`,
    explorerAddr: (addr) => `https://polygonscan.com/address/${addr}`,
  },
  {
    key: "arbitrum",
    name: "Arbitrum One",
    symbol: "ETH",
    chainId: 42161,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerTx: (hash) => `https://arbiscan.io/tx/${hash}`,
    explorerAddr: (addr) => `https://arbiscan.io/address/${addr}`,
  },
];

function Card({ title, children }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e6e6e6",
        borderRadius: 16,
        padding: 14,
        boxShadow: "0 1px 10px rgba(0,0,0,0.03)",
        marginBottom: 12,
      }}
    >
      {title ? <div style={{ fontWeight: 700, marginBottom: 10 }}>{title}</div> : null}
      {children}
    </div>
  );
}

function PillTabs({ value, onChange, tabs }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        background: "#f3f4f6",
        padding: 6,
        borderRadius: 999,
        marginBottom: 12,
      }}
    >
      {tabs.map((t) => {
        const active = value === t.value;
        return (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            style={{
              flex: 1,
              border: "none",
              cursor: "pointer",
              padding: "10px 12px",
              borderRadius: 999,
              fontWeight: 700,
              background: active ? "white" : "transparent",
              boxShadow: active ? "0 1px 10px rgba(0,0,0,0.06)" : "none",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const [tgUser, setTgUser] = useState(null);

  const [password, setPassword] = useState("");
  const [wallet, setWallet] = useState(null);
  const [seedPhrase, setSeedPhrase] = useState("");

  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);

  const [networkKey, setNetworkKey] = useState("eth");
  const network = useMemo(() => NETWORKS.find((n) => n.key === networkKey) || NETWORKS[0], [networkKey]);

  const [tab, setTab] = useState("receive"); // receive | send

  const [nativeBalance, setNativeBalance] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [lastTx, setLastTx] = useState("");

  useEffect(() => {
    const tg = window?.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      setTgUser(tg.initDataUnsafe?.user || null);
    }
  }, []);

  const address = useMemo(() => wallet?.address || "", [wallet]);

  function getProvider() {
    return new ethers.JsonRpcProvider(network.rpcUrl, {
      chainId: network.chainId,
      name: network.name,
    });
  }

  async function createNewWallet() {
    try {
      setStatus("");
      setLastTx("");
      if (!password || password.length < 6) {
        setStatus("Password must be at least 6 characters.");
        return;
      }
      const w = ethers.Wallet.createRandom();
      setSeedPhrase(w.mnemonic?.phrase || "");

      const encrypted = await w.encrypt(password);
      localStorage.setItem(STORAGE_KEY, encrypted);

      setWallet(w);
      setStatus("Wallet created + saved on this device.");
      setTimeout(refreshBalance, 600);
    } catch (e) {
      setStatus("Create wallet error: " + (e?.message || String(e)));
    }
  }

  async function unlockWallet() {
    try {
      setStatus("");
      setLastTx("");
      const encrypted = localStorage.getItem(STORAGE_KEY);
      if (!encrypted) {
        setStatus("No wallet saved on this device. Create one first.");
        return;
      }
      if (!password) {
        setStatus("Enter password to unlock.");
        return;
      }
      const w = await ethers.Wallet.fromEncryptedJson(encrypted, password);
      setWallet(w);
      setSeedPhrase("");
      setStatus("Wallet unlocked.");
      setTimeout(refreshBalance, 400);
    } catch {
      setStatus("Unlock failed (wrong password).");
    }
  }

  function deleteWalletFromDevice() {
    localStorage.removeItem(STORAGE_KEY);
    setWallet(null);
    setSeedPhrase("");
    setNativeBalance("");
    setTo("");
    setAmount("");
    setLastTx("");
    setStatus("Wallet deleted from this device.");
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setStatus("Copy failed (browser blocked clipboard).");
    }
  }

  async function refreshBalance() {
    try {
      if (!wallet) return;
      setStatus("");
      const provider = getProvider();
      const bal = await provider.getBalance(wallet.address);
      setNativeBalance(ethers.formatEther(bal));
    } catch (e) {
      setStatus("Balance error: " + (e?.message || String(e)));
    }
  }

  async function sendNative() {
    try {
      setStatus("");
      setLastTx("");
      if (!wallet) return;

      if (!to || !amount) {
        setStatus("Enter destination address + amount.");
        return;
      }

      // Quick address sanity check
      if (!ethers.isAddress(to)) {
        setStatus("Destination address looks invalid.");
        return;
      }

      const provider = getProvider();
      const signer = wallet.connect(provider);

      setStatus("Sending transaction...");
      const tx = await signer.sendTransaction({
        to,
        value: ethers.parseEther(amount),
      });

      setLastTx(tx.hash);
      setStatus("Broadcasted. Waiting confirmation...");
      await tx.wait();

      setStatus("Confirmed ✅");
      setTo("");
      setAmount("");
      refreshBalance();
    } catch (e) {
      setStatus("Send failed: " + (e?.message || String(e)));
    }
  }

  // When user changes network, refresh balance automatically
  useEffect(() => {
    if (wallet) refreshBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkKey, wallet]);

  return (
    <div style={{ fontFamily: "system-ui", padding: 14, maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Viaz Wallet</div>
          <div style={{ opacity: 0.7, fontSize: 12 }}>
            {tgUser ? `@${tgUser.username || "telegram-user"} • Non-custodial` : "Browser mode • Non-custodial"}
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, textAlign: "right" }}>
          Network
          <div style={{ fontWeight: 800, opacity: 1 }}>{network.name}</div>
        </div>
      </div>

      {!wallet ? (
        <>
          <Card title="Unlock / Create">
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
              Your private key stays on this device (encrypted). We never store it.
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Password</div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={createNewWallet}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 12,
                  border: "none",
                  background: "black",
                  color: "white",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Create Wallet
              </button>
              <button
                onClick={unlockWallet}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  background: "white",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Unlock
              </button>
            </div>

            {seedPhrase && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid #f1c40f" }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Seed phrase (SAVE THIS)</div>
                <div style={{ wordBreak: "break-word" }}>{seedPhrase}</div>
                <div style={{ marginTop: 8, color: "#b45309", fontSize: 12 }}>
                  If you lose your seed phrase, your funds cannot be recovered.
                </div>
              </div>
            )}
          </Card>

          <Card title="Network (choose where you want to use the wallet)">
            <select
              value={networkKey}
              onChange={(e) => setNetworkKey(e.target.value)}
              style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
            >
              {NETWORKS.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.name} ({n.symbol})
                </option>
              ))}
            </select>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              The same address works on EVM networks, but balances differ per network.
            </div>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 700 }}>Balance ({network.symbol})</div>
                <div style={{ fontSize: 26, fontWeight: 900, marginTop: 2 }}>
                  {nativeBalance === "" ? "—" : Number(nativeBalance).toFixed(6)}
                </div>
              </div>

              <div style={{ width: 170 }}>
                <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 700, marginBottom: 6 }}>Network</div>
                <select
                  value={networkKey}
                  onChange={(e) => setNetworkKey(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #ddd" }}
                >
                  {NETWORKS.map((n) => (
                    <option key={n.key} value={n.key}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={refreshBalance}
              style={{
                marginTop: 12,
                width: "100%",
                padding: 12,
                borderRadius: 12,
                border: "1px solid #ddd",
                background: "white",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Refresh Balance
            </button>
          </Card>

          <PillTabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "receive", label: "Receive" },
              { value: "send", label: "Send" },
            ]}
          />

          {tab === "receive" && (
            <Card title="Receive">
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
                Send {network.symbol} on <b>{network.name}</b> to this address:
              </div>

              <div style={{ fontWeight: 800, wordBreak: "break-word", marginBottom: 10 }}>{address}</div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                <button
                  onClick={copyAddress}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 12,
                    border: "none",
                    background: "black",
                    color: "white",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  {copied ? "Copied ✅" : "Copy Address"}
                </button>

                <a
                  href={network.explorerAddr(address)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    textDecoration: "none",
                    color: "black",
                    fontWeight: 900,
                  }}
                >
                  View on Explorer
                </a>
              </div>

              <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
                <QRCodeCanvas value={address} size={200} />
              </div>
            </Card>
          )}

          {tab === "send" && (
            <Card title={`Send ${network.symbol}`}>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
                You are sending on <b>{network.name}</b>.
              </div>

              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>To address</div>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="0x..."
                  style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
                />
              </div>

              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Amount</div>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={`e.g. 0.01 ${network.symbol}`}
                  style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
                />
              </div>

              <button
                onClick={sendNative}
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 12,
                  border: "none",
                  background: "black",
                  color: "white",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Send
              </button>

              {lastTx && (
                <a
                  href={network.explorerTx(lastTx)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "block",
                    marginTop: 10,
                    textAlign: "center",
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    textDecoration: "none",
                    color: "black",
                    fontWeight: 800,
                  }}
                >
                  View Transaction
                </a>
              )}
            </Card>
          )}

          <Card title="Security">
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
              Non-custodial: we don’t store your seed phrase. Keep it safe.
            </div>
            <button
              onClick={deleteWalletFromDevice}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 12,
                border: "1px solid #ddd",
                background: "white",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Delete Wallet From This Device
            </button>
          </Card>
        </>
      )}

      {status && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "#f3f4f6", fontSize: 13 }}>
          {status}
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 12, opacity: 0.6 }}>
        Tip: For real users, switch RPC URLs to Alchemy/Infura and add token support (USDT/USDC).
      </div>
    </div>
  );
}
