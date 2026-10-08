import { useState, useMemo, useEffect } from "react";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8080/api";
const inr = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const RATE = 10.5; // % p.a., keep in sync with Spring Boot rules

const emi = (p, years) => {
  const r = RATE / 1200, n = years * 12;
  return (p * r * (1 + r) ** n) / ((1 + r) ** n - 1);
};

/* Same rules as the Spring Boot EligibilityService (used live + as offline fallback) */
export function evaluate(f) {
  const income = +f.income || 0, amount = +f.amount || 0, years = +f.years || 0;
  const ready = income > 0 && amount > 0 && years > 0;
  const monthly = ready ? emi(amount, years) : 0;
  const foir = ready ? monthly / income : 0;
  const factors = [
    { label: "Credit history", max: 35, pts: { Good: 35, Average: 18, Poor: 0 }[f.history] ?? 0 },
    { label: "Repayment burden", max: 30, pts: !ready ? 0 : foir <= 0.3 ? 30 : foir <= 0.4 ? 20 : foir <= 0.5 ? 10 : 0 },
    { label: "Employment", max: 20, pts: { Salaried: 20, "Self-employed": 14, Business: 12, Unemployed: 0 }[f.employment] ?? 0 },
    { label: "Loan vs yearly income", max: 15, pts: !ready ? 0 : amount / (income * 12) <= 3 ? 15 : amount / (income * 12) <= 5 ? 8 : 0 },
  ];
  const score = factors.reduce((s, x) => s + x.pts, 0);
  const approved = ready && score >= 60 && foir <= 0.5 && f.employment !== "Unemployed";
  return { score, approved, emi: monthly, foir, factors };
}

const EMPTY = { name: "", income: "", amount: "", years: "", employment: "Salaried", history: "Good" };

function Gauge({ score, approved, ready }) {
  const len = 251.3;
  return (
    <div className="gauge">
      <svg viewBox="0 0 180 100" role="img" aria-label={`Eligibility score ${score} out of 100`}>
        <path d="M10 90 A80 80 0 0 1 170 90" className="g-track" />
        <path d="M10 90 A80 80 0 0 1 170 90" className={"g-fill " + (!ready ? "idle" : approved ? "ok" : "no")}
          style={{ strokeDasharray: len, strokeDashoffset: len * (1 - score / 100) }} />
      </svg>
      <div className="g-num">{ready ? score : "–"}<small>/100</small></div>
    </div>
  );
}

function Dashboard({ rows, go }) {
  const approved = rows.filter((r) => r.status === "Approved").length;
  const rate = rows.length ? Math.round((approved / rows.length) * 100) : 0;
  const total = rows.reduce((s, r) => s + +r.amount, 0);
  const stats = [["Applications", rows.length], ["Approved", approved], ["Not approved", rows.length - approved], ["Amount requested", inr(total)]];
  return (
    <>
      <header className="page-head">
        <div><h1>Loan desk overview</h1><p>Preliminary decisions from your configured eligibility rules.</p></div>
        <button className="btn primary" onClick={() => go("apply")}>New application</button>
      </header>
      <div className="stats">
        {stats.map(([l, v]) => <div className="stat" key={l}><span>{l}</span><b>{v}</b></div>)}
      </div>
      <Charts rows={rows} />
      <section className="panel">
        <h2>Approval rate: {rate}%</h2>
        <div className="split"><i style={{ width: rate + "%" }} /></div>
        <h2 className="mt">Latest applications</h2>
        {rows.slice(0, 5).map((r) => (
          <div className="line" key={r.id}>
            <div><b>{r.name}</b><small>{inr(r.amount)} over {r.years} yrs</small></div>
            <span className={"pill " + (r.status === "Approved" ? "ok" : "no")}>{r.status}</span>
          </div>
        ))}
      </section>
    </>
  );
}

function Apply({ onSave, hdr, onExpire }) {
  const [f, setF] = useState(EMPTY);
  const [touched, setTouched] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const live = useMemo(() => evaluate(f), [f]);
  const ready = +f.income > 0 && +f.amount > 0 && +f.years > 0;

  const errors = {
    name: f.name.trim().length < 2 && "Enter the applicant's full name",
    income: !(+f.income >= 5000) && "Monthly income must be at least ₹5,000",
    amount: !(+f.amount >= 50000) && "Loan amount must be at least ₹50,000",
    years: !(+f.years >= 1 && +f.years <= 30) && "Duration must be 1 to 30 years",
  };
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setResult(null); };
  const blur = (k) => () => setTouched({ ...touched, [k]: true });

  async function submit(e) {
    e.preventDefault();
    setTouched({ name: 1, income: 1, amount: 1, years: 1 });
    if (Object.values(errors).some(Boolean)) return;
    setBusy(true);
    let rec;
    try {
      const res = await fetch(`${API}/applications`, { method: "POST", headers: { "Content-Type": "application/json", ...hdr }, body: JSON.stringify(f) });
      if (res.status === 401) { setBusy(false); onExpire(); return; }
      if (!res.ok) throw new Error();
      rec = await res.json(); // expected: { id, status, score, ... }
    } catch {
      const r = evaluate(f); // backend offline: decide locally
      rec = { ...f, id: Date.now(), status: r.approved ? "Approved" : "Not Approved", score: r.score, date: new Date().toISOString().slice(0, 10) };
    }
    onSave(rec); setResult(rec); setBusy(false);
  }

  const Field = ({ k, label, type = "number", prefix, hint }) => (
    <label className={"field" + (touched[k] && errors[k] ? " bad" : "")}>
      <span>{label}</span>
      <div className="inp">{prefix && <em>{prefix}</em>}<input type={type} value={f[k]} onChange={set(k)} onBlur={blur(k)} /></div>
      {touched[k] && errors[k] ? <small className="err">{errors[k]}</small> : hint && <small>{hint}</small>}
    </label>
  );

  return (
    <>
      <header className="page-head"><div><h1>New loan application</h1><p>The score updates as you type, so you can see what moves the decision.</p></div></header>
      <div className="apply">
        <form className="panel" onSubmit={submit} noValidate>
          {Field({ k: "name", label: "Applicant name", type: "text" })}
          <div className="row">
            {Field({ k: "income", label: "Monthly income", prefix: "₹" })}
            {Field({ k: "amount", label: "Loan amount", prefix: "₹" })}
          </div>
          {Field({ k: "years", label: "Duration (years)", hint: "Between 1 and 30 years" })}
          <div className="row">
            <label className="field"><span>Employment</span><select value={f.employment} onChange={set("employment")}>
              {["Salaried", "Self-employed", "Business", "Unemployed"].map((o) => <option key={o}>{o}</option>)}</select></label>
            <label className="field"><span>Credit history</span><select value={f.history} onChange={set("history")}>
              {["Good", "Average", "Poor"].map((o) => <option key={o}>{o}</option>)}</select></label>
          </div>
          <div className="actions">
            <button type="submit" className="btn primary" disabled={busy}>{busy ? "Checking…" : "Check eligibility"}</button>
            <button type="button" className="btn" onClick={() => { setF(EMPTY); setResult(null); setTouched({}); }}>Clear form</button>
          </div>
        </form>

        <aside className="panel meter">
          <Gauge score={live.score} approved={live.approved} ready={ready} />
          <p className={"verdict " + (!ready ? "idle" : live.approved ? "ok" : "no")}>
            {!ready ? "Enter income, amount and duration" : live.approved ? "Likely to be approved" : "Likely not approved"}
          </p>
          <dl className="kv">
            <dt>Estimated EMI at {RATE}%</dt><dd>{ready ? inr(live.emi) : "–"}</dd>
            <dt>EMI as share of income</dt><dd>{ready ? Math.round(live.foir * 100) + "%" : "–"}</dd>
          </dl>
          {live.factors.map((x) => (
            <div className="factor" key={x.label}>
              <div><span>{x.label}</span><b>{x.pts}/{x.max}</b></div>
              <div className="bar"><i style={{ width: (x.pts / x.max) * 100 + "%" }} /></div>
            </div>
          ))}
          {result && (
            <div className={"final " + (result.status === "Approved" ? "ok" : "no")} role="status">
              <b>{result.status === "Approved" ? "Loan approved" : "Loan not approved"}</b>
              <span>Saved as application #{String(result.id).slice(-4)}</span>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function Applications({ rows }) {
  const [q, setQ] = useState("");
  const [flt, setFlt] = useState("All");
  const shown = rows.filter((r) => (flt === "All" || r.status === flt) && r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <header className="page-head"><div><h1>Applications</h1><p>Every applicant, request and decision on record.</p></div></header>
      <section className="panel">
        <div className="tools">
          <input className="search" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
          {["All", "Approved", "Not Approved"].map((s) => (
            <button key={s} className={"chip" + (flt === s ? " on" : "")} onClick={() => setFlt(s)}>{s}</button>
          ))}
        </div>
        <div className="scroll">
          <table>
            <thead><tr><th>Applicant</th><th>Income / mo</th><th>Loan</th><th>Term</th><th>Employment</th><th>Score</th><th>Decision</th><th>Date</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b></td><td>{inr(r.income)}</td><td>{inr(r.amount)}</td><td>{r.years} yrs</td>
                  <td>{r.employment}</td><td>{r.score}</td>
                  <td><span className={"pill " + (r.status === "Approved" ? "ok" : "no")}>{r.status}</span></td><td>{r.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <p className="empty">No applications match. Clear the search or filter to see all records.</p>}
        </div>
      </section>
    </>
  );
}

function Charts({ rows }) {
  const ok = rows.filter((r) => r.status === "Approved").length, no = rows.length - ok;
  const C = 2 * Math.PI * 40, share = rows.length ? ok / rows.length : 0;
  const types = ["Salaried", "Self-employed", "Business", "Unemployed"].map((t) => {
    const g = rows.filter((r) => r.employment === t);
    return { t, ok: g.filter((r) => r.status === "Approved").length, total: g.length };
  });
  const max = Math.max(1, ...types.map((x) => x.total));
  return (
    <div className="charts">
      <section className="panel">
        <h2>Approved vs not approved</h2>
        <div className="donut-wrap">
          <svg viewBox="0 0 100 100" className="donut" role="img" aria-label={`${ok} approved, ${no} not approved`}>
            <circle cx="50" cy="50" r="40" className="d-no" />
            <circle cx="50" cy="50" r="40" className="d-ok" strokeDasharray={`${share * C} ${C}`} transform="rotate(-90 50 50)" />
            <text x="50" y="55" textAnchor="middle" className="d-text">{rows.length}</text>
          </svg>
          <ul className="legend">
            <li><i className="ok" />Approved <b>{ok}</b></li>
            <li><i className="no" />Not approved <b>{no}</b></li>
          </ul>
        </div>
      </section>
      <section className="panel">
        <h2>Decisions by employment</h2>
        {types.map((x) => (
          <div className="hbar" key={x.t}>
            <span>{x.t}</span>
            <div className="track">
              <i className="ok" style={{ width: (x.ok / max) * 100 + "%" }} />
              <i className="no" style={{ width: ((x.total - x.ok) / max) * 100 + "%" }} />
            </div>
            <b>{x.total}</b>
          </div>
        ))}
      </section>
    </div>
  );
}

function Login({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ username: "", password: "", fullName: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const res = await fetch(`${API}/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      onAuth(data);
    } catch (ex) {
      setErr(ex instanceof TypeError ? "Cannot reach the server. Is the backend running on port 8080?" : ex.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <div className="login-art">
        <div className="brand">Lendwise</div>
        <h1>Loan decisions in seconds.</h1>
        <p>Check eligibility, see your score as you type, and keep every application on record.</p>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>{mode === "login" ? "Sign in" : "Create applicant account"}</h2>
        {mode === "register" && <label className="field"><span>Full name</span><input value={f.fullName} onChange={set("fullName")} /></label>}
        <label className="field"><span>Username</span><input value={f.username} onChange={set("username")} autoComplete="username" /></label>
        <label className="field"><span>Password</span><input type="password" value={f.password} onChange={set("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}>
          {mode === "login" ? "New applicant? Create an account" : "Already have an account? Sign in"}
        </button>
        {mode === "login" && <p className="hint">Demo: admin / admin123 (admin) or tejasri / user123 (applicant)</p>}
      </form>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState(() => { try { return JSON.parse(sessionStorage.getItem("auth")); } catch { return null; } });
  const [view, setView] = useState(() => (auth?.role === "ADMIN" ? "dashboard" : "apply"));
  const [rows, setRows] = useState([]);
  const isAdmin = auth?.role === "ADMIN";
  const hdr = auth ? { Authorization: `Bearer ${auth.token}` } : {};

  const logout = () => { try { sessionStorage.removeItem("auth"); } catch {} setAuth(null); setRows([]); };
  const login = (a) => { try { sessionStorage.setItem("auth", JSON.stringify(a)); } catch {} setAuth(a); setView(a.role === "ADMIN" ? "dashboard" : "apply"); };

  useEffect(() => {
    if (!isAdmin) return;
    fetch(`${API}/applications`, { headers: hdr })
      .then((r) => { if (r.status === 401) { logout(); return Promise.reject(); } return r.ok ? r.json() : Promise.reject(); })
      .then(setRows).catch(() => {});
  }, [isAdmin, auth]);

  if (!auth) return <Login onAuth={login} />;

  const nav = isAdmin ? [["dashboard", "Overview"], ["apply", "New application"], ["list", "Applications"]] : [["apply", "New application"]];
  return (
    <div className="shell">
      <nav className="side">
        <div className="brand">Lendwise</div>
        {nav.map(([k, l]) => <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>)}
        <div className="who">
          <b>{auth.fullName}</b><span>{isAdmin ? "Admin" : "Applicant"}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </nav>
      <main>
        {view === "dashboard" && isAdmin && <Dashboard rows={rows} go={setView} />}
        {view === "apply" && <Apply hdr={hdr} onExpire={logout} onSave={(r) => setRows([r, ...rows])} />}
        {view === "list" && isAdmin && <Applications rows={rows} />}
      </main>
    </div>
  );
}
