import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "./supabase";

const STORAGE_KEY = "wallet_encrypted_v1";
const RPC_URL = "https://eth.llamarpc.com";

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
      {title ? <div style={{ fontWeight: 800, marginBottom: 10 }}>{title}</div> : null}
      {children}
    </div>
  );
}

export default function App() {
  // Telegram optional
  const [tgUser, setTgUser] = useState(null);

  // Supabase session
  const [session, setSession] = useState(null);
  const user = session?.user || null;

  // UI
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  // Auth form
  const [email, setEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Username/profile
  const [usernameInput, setUsernameInput] = useState("");
  const [profileUsername, setProfileUsername] = useState("");

  // Wallet
  const [walletPassword, setWalletPassword] = useState("");
  const [wallet, setWallet] = useState(null);
  const [seedPhrase, setSeedPhrase] = useState("");
  const [ethBalance, setEthBalance] = useState("");
  const [copied, setCopied] = useState(false);

  // Send
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [lastTx, setLastTx] = useState("");

  const address = useMemo(() => wallet?.address || "", [wallet]);

  useEffect(() => {
    const tg = window?.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      setTgUser(tg.initDataUnsafe?.user || null);
    }
  }, []);

  // Load session at start + listen changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Fetch profile when logged in
  useEffect(() => {
    if (!user) return;
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function isEmailVerified() {
    return !!user?.email_confirmed_at;
  }

  function getProvider() {
    return new ethers.JsonRpcProvider(RPC_URL);
  }

  async function signUp() {
    try {
      setLoading(true);
      setStatus("");
      const { error } = await supabase.auth.signUp({ email, password: loginPassword });
      if (error) throw error;
      setStatus("Signup created. Check your email and click the verification link. Then log in.");
    } catch (e) {
      setStatus("Signup error: " + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  }

  async function logIn() {
    try {
      setLoading(true);
      setStatus("");
      const { error } = await supabase.auth.signInWithPassword({ email, password: loginPassword });
      if (error) throw error;
      setStatus("Logged in.");
    } catch (e) {
      setStatus("Login error: " + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  }

  async function logOut() {
    await supabase.auth.signOut();
    setWallet(null);
    setSeedPhrase("");
    setEthBalance("");
    setProfileUsername("");
    setTo("");
    setAmount("");
    setLastTx("");
    setStatus("Logged out.");
  }

  async function fetchProfile() {
    try {
      setStatus("");
      const { data, error } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;
      setProfileUsername(data?.username || "");
    } catch (e) {
      setStatus("Profile error: " + (e?.message || String(e)));
    }
  }

  async function saveUsername() {
    try {
      setLoading(true);
      setStatus("");

      if (!usernameInput || usernameInput.length < 3) {
        setStatus("Username must be at least 3 characters.");
        return;
      }

      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          username: usernameInput,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (error) throw error;

      setProfileUsername(usernameInput);
      setUsernameInput("");
      setStatus("Username saved.");
    } catch (e) {
      setStatus("Username error: " + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  }

  async function refreshBalance() {
    try {
      if (!wallet) return;
      const provider = getProvider();
      const bal = await provider.getBalance(wallet.address);
      setEthBalance(ethers.formatEther(bal));
    } catch (e) {
      setStatus("Balance error: " + (e?.message || String(e)));
    }
  }

  async function createWalletAndBackup() {
    try {
      setLoading(true);
      setStatus("");
      setSeedPhrase("");
      setLastTx("");

      if (!isEmailVerified()) {
        setStatus("Please verify your email first.");
        return;
      }
      if (!profileUsername) {
        setStatus("Please create a username first.");
        return;
      }
      if (!walletPassword || walletPassword.length < 6) {
        setStatus("Wallet password must be at least 6 characters.");
        return;
      }

      const w = ethers.Wallet.createRandom();
      setSeedPhrase(w.mnemonic?.phrase || "");

      const encrypted = await w.encrypt(walletPassword);

      // save locally
      localStorage.setItem(STORAGE_KEY, encrypted);

      // backup encrypted blob to account
      const { error } = await supabase.from("wallet_backups").upsert(
        {
          user_id: user.id,
          encrypted_wallet_json: encrypted,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (error) throw error;

      setWallet(w);
      setStatus("Wallet created + backed up (encrypted).");
      setTimeout(refreshBalance, 600);
    } catch (e) {
      setStatus("Create wallet error: " + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  }

  async function unlockLocalWallet() {
    try {
      setLoading(true);
      setStatus("");
      setLastTx("");

      const encrypted = localStorage.getItem(STORAGE_KEY);
      if (!encrypted) {
        setStatus("No wallet on this device. Use Restore from Account.");
        return;
      }
      if (!walletPassword) {
        setStatus("Enter wallet password.");
        return;
      }

      const w = await ethers.Wallet.fromEncryptedJson(encrypted, walletPassword);
      setWallet(w);
      setSeedPhrase("");
      setStatus("Wallet unlocked (this device).");
      setTimeout(refreshBalance, 500);
    } catch {
      setStatus("Unlock failed (wrong wallet password).");
    } finally {
      setLoading(false);
    }
  }

  async function restoreFromAccount() {
    try {
      setLoading(true);
      setStatus("");
      setLastTx("");

      if (!walletPassword) {
        setStatus("Enter wallet password to decrypt the backup.");
        return;
      }

      const { data, error } = await supabase
        .from("wallet_backups")
        .select("encrypted_wallet_json")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      if (!data?.encrypted_wallet_json) {
        setStatus("No wallet backup found for this account.");
        return;
      }

      // store on device and decrypt locally
      localStorage.setItem(STORAGE_KEY, data.encrypted_wallet_json);
      const w = await ethers.Wallet.fromEncryptedJson(data.encrypted_wallet_json, walletPassword);

      setWallet(w);
      setSeedPhrase("");
      setStatus("Wallet restored from account backup.");
      setTimeout(refreshBalance, 500);
    } catch (e) {
      setStatus("Restore error: " + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setStatus("Copy failed.");
    }
  }

  async function sendEth() {
    try {
      setLoading(true);
      setStatus("");
      setLastTx("");

      if (!wallet) {
        setStatus("Unlock wallet first.");
        return;
      }
      if (!ethers.isAddress(to)) {
        setStatus("Invalid destination address.");
        return;
      }
      if (!amount) {
        setStatus("Enter amount.");
        return;
      }

      const provider = getProvider();
      const signer = wallet.connect(provider);

      setStatus("Sending...");
      const tx = await signer.sendTransaction({ to, value: ethers.parseEther(amount) });

      setLastTx(tx.hash);
      setStatus("Broadcasted: " + tx.hash);

      await tx.wait();
      setStatus("Confirmed ✅ " + tx.hash);

      setTo("");
      setAmount("");
      refreshBalance();
    } catch (e) {
      setStatus("Send error: " + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  }

  function deleteWalletFromDevice() {
    localStorage.removeItem(STORAGE_KEY);
    setWallet(null);
    setSeedPhrase("");
    setEthBalance("");
    setTo("");
    setAmount("");
    setLastTx("");
    setStatus("Wallet removed from this device (account backup remains).");
  }

  const verified = isEmailVerified();

  return (
    <div style={{ fontFamily: "system-ui", padding: 14, maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>Viaz Wallet</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {tgUser ? `Telegram: @${tgUser.username || "user"}` : "Website / Browser"}
          </div>
        </div>
        {user ? (
          <button
            onClick={logOut}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #ddd",
              background: "white",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Logout
          </button>
        ) : null}
      </div>

      {!user ? (
        <Card title="Login / Signup">
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
            Signup uses email verification. After verifying, create a username.
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Email</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Password</div>
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="min 6 characters"
              style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              disabled={loading}
              onClick={signUp}
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
              Sign Up
            </button>
            <button
              disabled={loading}
              onClick={logIn}
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 12,
                border: "1px solid #ddd",
                background: "white",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Log In
            </button>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            After Sign Up, check your email and click the verification link.
          </div>
        </Card>
      ) : (
        <>
          <Card title="Account">
            <div style={{ fontSize: 13 }}>
              <div>
                <b>Email:</b> {user.email}
              </div>
              <div>
                <b>Verified:</b> {verified ? "Yes ✅" : "No ❌ (check email)"}
              </div>
              <div>
                <b>Username:</b> {profileUsername ? profileUsername : "Not set"}
              </div>
            </div>

            {!verified && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "#fff7ed", border: "1px solid #fed7aa" }}>
                Please verify your email. Open your inbox and click the verification link, then log in again.
              </div>
            )}

            {verified && !profileUsername && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>Create username</div>
                <input
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="choose a unique username"
                  style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd", marginBottom: 10 }}
                />
                <button
                  disabled={loading}
                  onClick={saveUsername}
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
                  Save Username
                </button>
              </div>
            )}
          </Card>

          <Card title="Wallet (non-custodial)">
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
              Wallet stays encrypted. We store only encrypted backup so you can access from website + Telegram.
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Wallet password</div>
              <input
                type="password"
                value={walletPassword}
                onChange={(e) => setWalletPassword(e.target.value)}
                placeholder="used to encrypt/decrypt your wallet"
                style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                disabled={loading || !verified || !profileUsername}
                onClick={createWalletAndBackup}
                style={{
                  flex: "1 1 200px",
                  padding: 12,
                  borderRadius: 12,
                  border: "none",
                  background: "black",
                  color: "white",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Create Wallet + Backup
              </button>

              <button
                disabled={loading}
                onClick={unlockLocalWallet}
                style={{
                  flex: "1 1 200px",
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  background: "white",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Unlock (This Device)
              </button>

              <button
                disabled={loading}
                onClick={restoreFromAccount}
                style={{
                  flex: "1 1 200px",
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  background: "white",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Restore from Account
              </button>
            </div>

            {seedPhrase && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid #f59e0b" }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Seed phrase (SAVE THIS)</div>
                <div style={{ wordBreak: "break-word" }}>{seedPhrase}</div>
                <div style={{ marginTop: 8, fontSize: 12, color: "#b45309" }}>
                  If you lose it, funds cannot be recovered.
                </div>
              </div>
            )}

            {wallet && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Address</div>
                <div style={{ wordBreak: "break-word", fontWeight: 800 }}>{address}</div>

                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
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
                    {copied ? "Copied ✅" : "Copy"}
                  </button>

                  <button
                    onClick={refreshBalance}
                    style={{
                      flex: 1,
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
                </div>

                <div style={{ marginTop: 10, fontSize: 14 }}>
                  <b>ETH Balance:</b> {ethBalance === "" ? "—" : Number(ethBalance).toFixed(6)}
                </div>

                <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                  <QRCodeCanvas value={address} size={200} />
                </div>

                <div style={{ marginTop: 14, fontWeight: 900 }}>Send ETH</div>

                <div style={{ marginTop: 8 }}>
                  <input
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="To address (0x...)"
                    style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd", marginBottom: 10 }}
                  />
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Amount (ETH)"
                    style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd", marginBottom: 10 }}
                  />
                  <button
                    disabled={loading}
                    onClick={sendEth}
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
                    <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, wordBreak: "break-word" }}>
                      Last tx: {lastTx}
                    </div>
                  )}
                </div>

                <button
                  onClick={deleteWalletFromDevice}
                  style={{
                    width: "100%",
                    marginTop: 12,
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
              </div>
            )}
          </Card>
        </>
      )}

      {status && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "#f3f4f6", fontSize: 13 }}>
          {status}
        </div>
      )}
    </div>
  );
}
