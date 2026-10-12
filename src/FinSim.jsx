import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Sparkles, ShieldAlert, SlidersHorizontal, Stamp, FlaskConical, FileText,
  ArrowRight, Loader2, CircleCheck, CircleAlert, RotateCcw,
} from "lucide-react";
 
// ---------- palette ----------
// ink:    #0B1F1C  (deep pine — base)
// panel:  #132E29  (raised panel)
// line:   #24463F  (hairline)
// gold:   #C9A227  (currency accent / primary)
// coral:  #E2725B  (risk / warning)
// mint:   #5FAE7D  (positive / safe)
// ivory:  #F2EFE6  (primary text)
// sage:   #92AFA6  (muted text)
 
const STAGES = [
  { id: 0, label: "Profile", sub: "Extract", icon: Sparkles },
  { id: 1, label: "Scenarios", sub: "Simulate", icon: FileText },
  { id: 2, label: "Critique", sub: "Debate", icon: ShieldAlert },
  { id: 3, label: "What-If", sub: "Stress-test", icon: SlidersHorizontal },
  { id: 4, label: "Verdict", sub: "Recommend", icon: Stamp },
  { id: 5, label: "Prompt Lab", sub: "Compare", icon: FlaskConical },
];
 
const SCENARIO_META = [
  { key: "buyNow", label: "Buy Now", color: "#E2725B" },
  { key: "saveFirst", label: "Save First", color: "#C9A227" },
  { key: "budget", label: "Budget Option", color: "#5FAE7D" },
  { key: "emi", label: "EMI", color: "#7C93C9" },
  { key: "delay", label: "Delay", color: "#92AFA6" },
];
 
const inr = (n) =>
  "\u20B9" + Math.round(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
 
async function askClaude(prompt, { json = false } = {}) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error("Request failed (" + res.status + ")");
  const data = await res.json();
  const text = data.text || "";
  if (!json) return text;
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(cleaned.slice(start, end + 1));
}
 
// ---------- deterministic simulation engine (no LLM here, ever) ----------
function emiFor(principal, annualRatePct, months) {
  const r = annualRatePct / 12 / 100;
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}
 
function simulate(profile, overrides = {}) {
  const income = profile.income * (1 + (overrides.incomeDeltaPct || 0) / 100);
  const expenses = profile.expenses + (overrides.expenseDelta || 0);
  const price = profile.price + (overrides.priceDelta || 0);
  const savings0 = profile.savings;
  const horizon = profile.horizon || 6;
  const surplus = income - expenses;
  const budgetPrice = price * 0.6;
  const emiMonths = Math.min(horizon, 6) || 6;
  const emiRate = 12;
  const emi = emiFor(price, emiRate, emiMonths);
 
  const rows = [];
  let sBuy = savings0 - price;
  let sSave = savings0;
  let sBudget = savings0 - budgetPrice;
  let sEmi = savings0;
  let sDelay = savings0;
  let saveFirstBoughtAt = null;
 
  for (let m = 1; m <= horizon; m++) {
    sBuy += surplus;
    sSave += surplus;
    if (saveFirstBoughtAt === null && sSave >= price) {
      sSave -= price;
      saveFirstBoughtAt = m;
    }
    sBudget += surplus;
    sEmi += surplus - (m <= emiMonths ? emi : 0);
    sDelay += surplus;
    rows.push({
      month: "M" + m,
      buyNow: Math.round(sBuy),
      saveFirst: Math.round(sSave),
      budget: Math.round(sBudget),
      emi: Math.round(sEmi),
      delay: Math.round(sDelay),
    });
  }
 
  const emergencyTarget = expenses * 6;
  const finalRow = rows[rows.length - 1] || {};
  return {
    rows,
    surplus,
    emergencyTarget,
    emi,
    emiMonths,
    saveFirstBoughtAt,
    budgetPrice,
    final: finalRow,
    resolvedPrice: price,
    resolvedIncome: income,
    resolvedExpenses: expenses,
  };
}
 
// break-even: how much can expenses rise before Save First takes longer than the horizon
function findExpenseBreakpoint(profile) {
  let lo = 0, hi = 30000;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    const sim = simulate(profile, { expenseDelta: mid });
    if (sim.saveFirstBoughtAt !== null && sim.saveFirstBoughtAt <= (profile.horizon || 6)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return Math.round(lo / 100) * 100;
}
 
// ---------- small UI atoms ----------
function Field({ label, value, onChange, prefix }) {
  return (
    <label className="fs-field">
      <span>{label}</span>
      <div className="fs-field-input">
        {prefix && <em>{prefix}</em>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </label>
  );
}
 
function StageShell({ eyebrow, title, children }) {
  return (
    <div className="fs-stage">
      <div className="fs-stage-head">
        <span className="fs-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
 
export default function FinSim() {
  const [stage, setStage] = useState(0);
  const [raw, setRaw] = useState(
    "I earn ₹50,000 monthly. I have ₹40,000 saved. I want to buy a ₹1,00,000 laptop. My monthly expenses are ₹25,000. Give me 6 months."
  );
  const [profile, setProfile] = useState(null);
  const [missing, setMissing] = useState([]);
 
  const [chatMessages, setChatMessages] = useState([]);
  const [chatProfile, setChatProfile] = useState({ income: null, savings: null, expenses: null, price: null, horizon: null, goal: null });
  const [chatMissing, setChatMissing] = useState([]);
  const [chatDone, setChatDone] = useState(false);
  const [chatStarted, setChatStarted] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatRunning, setChatRunning] = useState(false);
  const [chatErr, setChatErr] = useState("");
 
  const [overrides, setOverrides] = useState({ incomeDeltaPct: 0, expenseDelta: 0, priceDelta: 0 });
 
  const [debate, setDebate] = useState(null);
  const [debating, setDebating] = useState(false);
  const [debateErr, setDebateErr] = useState("");
 
  const [verdict, setVerdict] = useState(null);
  const [verdicting, setVerdicting] = useState(false);
  const [verdictErr, setVerdictErr] = useState("");
 
  const [labQuery, setLabQuery] = useState("Should I buy a ₹1,00,000 laptop right now or wait?");
  const [labGeneric, setLabGeneric] = useState("");
  const [labSpecial, setLabSpecial] = useState("");
  const [labRunning, setLabRunning] = useState(false);
  const [labErr, setLabErr] = useState("");
 
  const baseSim = useMemo(() => (profile ? simulate(profile) : null), [profile]);
  const liveSim = useMemo(() => (profile ? simulate(profile, overrides) : null), [profile, overrides]);
  const breakpoint = useMemo(() => (profile ? findExpenseBreakpoint(profile) : null), [profile]);
 
  function clarifierPrompt(history, known) {
    const transcript = history.map((m) => (m.role === "user" ? "User: " : "Agent: ") + m.text).join("\n");
    return `You are a Financial Profile Clarifier agent inside a decision-simulation tool. Your job is to verify the user's financial details and ask ONE short, friendly clarifying question at a time for whatever is missing or ambiguous, until you know: income, savings, expenses, and purchase price. Time horizon and goal are nice to have but not blocking.
 
Known so far (null = not yet known):
${JSON.stringify(known)}
 
Conversation so far:
${transcript}
 
Return ONLY compact JSON, no prose, no markdown fences, with this exact shape:
{"reply": string, "profile": {"income": number|null, "savings": number|null, "expenses": number|null, "price": number|null, "horizon": number|null, "goal": string|null}, "missing": string[], "done": boolean}
 
Rules:
- "profile" must carry forward every value already known plus anything the user's latest message revealed. Never null out something already known.
- "missing" lists only fields still unknown among income/savings/expenses/price.
- Never invent a number — if the user hasn't stated it, leave it null and ask.
- If income, savings, expenses, and price are all known, set "done": true and make "reply" a one-sentence confirmation summary instead of a question.
- Otherwise set "done": false and make "reply" a short question about exactly ONE missing field.`;
  }
 
  async function runClarifierTurn(history, known) {
    setChatRunning(true);
    setChatErr("");
    try {
      const out = await askClaude(clarifierPrompt(history, known), { json: true });
      setChatMessages((prev) => [...prev, { role: "assistant", text: out.reply }]);
      setChatProfile(out.profile);
      setChatMissing(out.missing || []);
      setChatDone(!!out.done);
    } catch (e) {
      setChatErr("The clarifier agent didn't respond — try sending that again.");
    } finally {
      setChatRunning(false);
    }
  }
 
  function startClarifier() {
    if (!raw.trim()) return;
    const history = [{ role: "user", text: raw }];
    setChatMessages(history);
    setChatStarted(true);
    runClarifierTurn(history, chatProfile);
  }
 
  function sendChatReply() {
    if (!chatInput.trim() || chatRunning) return;
    const history = [...chatMessages, { role: "user", text: chatInput }];
    setChatMessages(history);
    setChatInput("");
    runClarifierTurn(history, chatProfile);
  }
 
  function applyExtraction(out) {
    setProfile({
      income: out.income || 0,
      savings: out.savings || 0,
      expenses: out.expenses || 0,
      price: out.price || 0,
      horizon: out.horizon || 6,
      goal: out.goal || "Purchase",
    });
    setMissing(out.missing || []);
    setOverrides({ incomeDeltaPct: 0, expenseDelta: 0, priceDelta: 0 });
    setDebate(null);
    setVerdict(null);
  }
 
  function useManualProfile() {
    setProfile({ income: 50000, savings: 40000, expenses: 25000, price: 100000, horizon: 6, goal: "Purchase" });
    setMissing([]);
  }
 
  async function runDebate() {
    if (!profile || !baseSim) return;
    setDebating(true);
    setDebateErr("");
    try {
      const ctx = `Profile: income ₹${profile.income}/mo, savings ₹${profile.savings}, expenses ₹${profile.expenses}/mo, purchase ₹${profile.price} ("${profile.goal}"), horizon ${profile.horizon} months.
Simulation after ${profile.horizon} months — Buy Now savings: ${inr(baseSim.final.buyNow)}, Save First savings: ${inr(baseSim.final.saveFirst)} (purchase completed month ${baseSim.saveFirstBoughtAt ?? "beyond horizon"}), Budget Option savings: ${inr(baseSim.final.budget)}, EMI savings: ${inr(baseSim.final.emi)} (EMI ${inr(baseSim.emi)}/mo), Delay savings: ${inr(baseSim.final.delay)}.
Recommended emergency reserve (6 months expenses): ${inr(baseSim.emergencyTarget)}.`;
      const out = await askClaude(
        `You are simulating a two-agent debate about a financial decision. Return ONLY JSON with this shape:
{"planner": string, "critic": string, "revised": string}
"planner" (max 45 words): a planner agent proposes ONE scenario as the plan, with a one-line reason.
"critic" (max 45 words): a skeptical critic agent finds a concrete flaw or risk in that specific plan, referencing the numbers.
"revised" (max 45 words): the planner's revised, more defensible position after hearing the critique.
Ground every sentence in these numbers, do not invent figures:
${ctx}`,
        { json: true }
      );
      setDebate(out);
      setStage(2);
    } catch (e) {
      setDebateErr("The debate agents couldn't reach a verdict — check your connection and try again.");
    } finally {
      setDebating(false);
    }
  }
 
  async function runVerdict() {
    if (!profile || !liveSim) return;
    setVerdicting(true);
    setVerdictErr("");
    try {
      const ctx = `Profile: income ₹${profile.income}/mo, savings ₹${profile.savings}, expenses ₹${liveSim.resolvedExpenses}/mo, purchase ₹${liveSim.resolvedPrice}, horizon ${profile.horizon} months.
Final savings by scenario — Buy Now ${inr(liveSim.final.buyNow)}, Save First ${inr(liveSim.final.saveFirst)} (bought month ${liveSim.saveFirstBoughtAt ?? "n/a"}), Budget ${inr(liveSim.final.budget)}, EMI ${inr(liveSim.final.emi)}, Delay ${inr(liveSim.final.delay)}.
Emergency reserve target: ${inr(liveSim.emergencyTarget)}. Expenses could rise by up to ₹${breakpoint} before Save First misses the ${profile.horizon}-month window.
${debate ? "Prior critique from a risk agent: " + debate.critic : ""}`;
      const out = await askClaude(
        `Act as a final decision agent for a personal finance simulator. Based strictly on the numbers below, return ONLY JSON:
{"recommended": string, "reasons": string[3], "tradeoff": string, "confidence": "High"|"Medium"|"Low", "breakStatement": string}
"recommended" is one of: Buy Now, Save First, Budget Option, EMI, Delay.
"reasons" are 3 short bullet phrases (max 10 words each).
"tradeoff" is one sentence on what the user gives up.
"breakStatement" is one sentence stating the condition under which this recommendation would flip, using the expense breakpoint figure given.
Numbers:
${ctx}`,
        { json: true }
      );
      setVerdict(out);
      setStage(4);
    } catch (e) {
      setVerdictErr("Couldn't generate a verdict right now — try again in a moment.");
    } finally {
      setVerdicting(false);
    }
  }
 
  async function runPromptLab() {
    setLabRunning(true);
    setLabErr("");
    setLabGeneric("");
    setLabSpecial("");
    try {
      const [g, s] = await Promise.all([
        askClaude(`You are a helpful financial assistant. ${labQuery}`),
        askClaude(
          `You are a Financial Risk Analyst agent inside a decision-simulation pipeline. You never give generic advice — you reason only from stated numbers, flag missing constraints, name at least one concrete risk, and state your confidence. If numbers are missing, say exactly which ones. Question: ${labQuery}`
        ),
      ]);
      setLabGeneric(g);
      setLabSpecial(s);
    } catch (e) {
      setLabErr("One or both prompts failed to run — try again.");
    } finally {
      setLabRunning(false);
    }
  }
 
  const canGo = (i) => i === 0 || profile;
 
  return (
    <div className="fs-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .fs-root {
          --ink:#0B1F1C; --panel:#132E29; --panel2:#0F2621; --line:#24463F;
          --gold:#C9A227; --coral:#E2725B; --mint:#5FAE7D; --slate:#7C93C9;
          --ivory:#F2EFE6; --sage:#92AFA6;
          background:var(--ink); color:var(--ivory);
          font-family:'IBM Plex Sans',sans-serif;
          min-height:100vh; display:flex; flex-direction:column;
        }
        .fs-root * { box-sizing:border-box; }
        .fs-num { font-family:'IBM Plex Mono',monospace; }
        .fs-header {
          display:flex; align-items:baseline; justify-content:space-between;
          padding:22px 28px; border-bottom:1px solid var(--line);
        }
        .fs-brand { display:flex; align-items:baseline; gap:10px; }
        .fs-brand h1 { font-family:'Fraunces',serif; font-size:26px; font-weight:600; margin:0; letter-spacing:0.2px; }
        .fs-brand span { color:var(--sage); font-size:13px; }
        .fs-vitals { display:flex; gap:22px; }
        .fs-vital { text-align:right; }
        .fs-vital small { display:block; color:var(--sage); font-size:11px; }
        .fs-vital strong { font-family:'IBM Plex Mono',monospace; font-size:15px; color:var(--gold); }
        .fs-body { display:flex; flex:1; min-height:640px; }
        .fs-nav {
          width:196px; border-right:1px solid var(--line); padding:18px 0; flex-shrink:0;
        }
        .fs-nav-item {
          display:flex; align-items:center; gap:11px; padding:13px 20px; cursor:pointer;
          border-left:2px solid transparent; opacity:0.5; position:relative;
        }
        .fs-nav-item.active { opacity:1; border-left-color:var(--gold); background:rgba(201,162,39,0.06); }
        .fs-nav-item.locked { cursor:not-allowed; opacity:0.28; }
        .fs-nav-item .fs-navnum { font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--sage); width:16px; }
        .fs-nav-item svg { width:15px; height:15px; color:var(--gold); flex-shrink:0; }
        .fs-nav-item div span { display:block; }
        .fs-nav-item .fs-navlabel { font-size:13.5px; font-weight:500; }
        .fs-nav-item .fs-navsub { font-size:11px; color:var(--sage); }
        .fs-main { flex:1; padding:30px 36px; overflow:auto; }
        .fs-stage-head { margin-bottom:20px; }
        .fs-eyebrow { font-size:11.5px; color:var(--gold); letter-spacing:0.4px; }
        .fs-stage-head h2 { font-family:'Fraunces',serif; font-size:24px; font-weight:600; margin:4px 0 0; }
        .fs-panel {
          background:var(--panel); border:1px solid var(--line); border-radius:3px; padding:20px;
        }
        textarea.fs-input {
          width:100%; background:var(--panel2); border:1px solid var(--line); border-radius:3px;
          color:var(--ivory); padding:13px; font-family:'IBM Plex Sans',sans-serif; font-size:14px;
          min-height:96px; resize:vertical;
        }
        textarea.fs-input:focus, input:focus { outline:2px solid var(--gold); outline-offset:1px; }
        .fs-btn {
          background:var(--gold); color:var(--ink); border:none; border-radius:3px;
          padding:11px 20px; font-weight:600; font-size:13.5px; cursor:pointer;
          display:inline-flex; align-items:center; gap:8px; margin-top:14px;
        }
        .fs-btn:disabled { opacity:0.55; cursor:wait; }
        .fs-btn.ghost { background:transparent; color:var(--sage); border:1px solid var(--line); }
        .fs-err { color:var(--coral); font-size:13px; margin-top:10px; display:flex; gap:7px; align-items:flex-start; }
        .fs-err svg { width:14px; height:14px; margin-top:2px; flex-shrink:0; }
        .fs-fields { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:18px; }
        .fs-field { display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--sage); }
        .fs-field-input { display:flex; align-items:center; background:var(--panel2); border:1px solid var(--line); border-radius:3px; padding:0 10px; }
        .fs-field-input em { font-style:normal; color:var(--gold); margin-right:4px; font-family:'IBM Plex Mono',monospace; }
        .fs-field-input input { background:none; border:none; color:var(--ivory); padding:9px 0; width:100%; font-family:'IBM Plex Mono',monospace; }
        .fs-missing { margin-top:14px; padding:10px 12px; border:1px dashed var(--coral); border-radius:3px; font-size:12.5px; color:var(--coral); }
        .fs-chat { display:flex; flex-direction:column; gap:10px; max-height:360px; overflow-y:auto; padding-right:4px; }
        .fs-chat-bubble { padding:11px 14px; border-radius:3px; font-size:13.5px; line-height:1.5; max-width:80%; }
        .fs-chat-bubble b { display:block; font-size:10.5px; color:var(--sage); margin-bottom:4px; font-weight:500; }
        .fs-chat-bubble.user { align-self:flex-end; background:rgba(201,162,39,0.1); border-left:3px solid var(--gold); }
        .fs-chat-bubble.assistant { align-self:flex-start; background:var(--panel2); border-left:3px solid var(--slate); }
        .fs-chat-typing { display:flex; align-items:center; gap:8px; opacity:0.75; }
        .fs-chat-input-row { display:flex; gap:10px; margin-top:14px; }
        .fs-chat-input { flex:1; background:var(--panel2); border:1px solid var(--line); border-radius:3px; color:var(--ivory); padding:11px 13px; font-family:'IBM Plex Sans',sans-serif; font-size:13.5px; }
        .fs-chat-input:focus { outline:2px solid var(--gold); outline-offset:1px; }
        .fs-health { margin-top:22px; display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:3px; overflow:hidden; }
        .fs-health div { background:var(--panel); padding:14px 16px; }
        .fs-health small { display:block; color:var(--sage); font-size:11px; margin-bottom:5px; }
        .fs-health strong { font-family:'IBM Plex Mono',monospace; font-size:16px; }
        .fs-legend-row { display:flex; gap:16px; flex-wrap:wrap; margin:14px 0 4px; }
        .fs-legend-chip { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--sage); }
        .fs-legend-dot { width:9px; height:9px; border-radius:50%; }
        table.fs-table { width:100%; border-collapse:collapse; margin-top:16px; font-size:13px; }
        table.fs-table th { text-align:left; color:var(--sage); font-weight:500; font-size:11.5px; padding:8px 10px; border-bottom:1px solid var(--line); }
        table.fs-table td { padding:9px 10px; border-bottom:1px solid var(--line); font-family:'IBM Plex Mono',monospace; }
        table.fs-table tr:last-child td { border-bottom:none; }
        .fs-debate { display:flex; flex-direction:column; gap:14px; margin-top:6px; }
        .fs-bubble { padding:14px 16px; border-radius:3px; max-width:640px; font-size:13.5px; line-height:1.55; }
        .fs-bubble.planner { background:rgba(201,162,39,0.09); border-left:3px solid var(--gold); align-self:flex-start; }
        .fs-bubble.critic { background:rgba(226,114,91,0.09); border-left:3px solid var(--coral); align-self:flex-end; }
        .fs-bubble.revised { background:rgba(95,174,125,0.09); border-left:3px solid var(--mint); align-self:flex-start; }
        .fs-bubble b { display:block; font-size:11px; text-transform:none; color:var(--sage); margin-bottom:6px; }
        .fs-sliders { display:flex; flex-direction:column; gap:20px; max-width:460px; }
        .fs-slider label { display:flex; justify-content:space-between; font-size:13px; margin-bottom:8px; }
        .fs-slider label strong { color:var(--gold); font-family:'IBM Plex Mono',monospace; }
        .fs-slider input[type=range] { width:100%; accent-color:#C9A227; }
        .fs-break { margin-top:18px; padding:12px 14px; background:rgba(226,114,91,0.08); border:1px solid var(--coral); border-radius:3px; font-size:13px; }
        .fs-verdict { padding:26px; border:1px solid var(--gold); border-radius:4px; position:relative; }
        .fs-verdict-tag { font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--gold); border:1px solid var(--gold); display:inline-block; padding:3px 9px; border-radius:20px; }
        .fs-verdict h3 { font-family:'Fraunces',serif; font-size:28px; margin:14px 0 18px; }
        .fs-verdict ul { margin:0 0 16px; padding-left:18px; }
        .fs-verdict li { margin-bottom:6px; font-size:13.5px; }
        .fs-verdict .fs-conf { display:flex; gap:10px; align-items:center; margin-top:16px; font-size:12.5px; color:var(--sage); }
        .fs-lab-grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:20px; }
        .fs-lab-col h4 { font-size:12px; color:var(--sage); margin:0 0 10px; display:flex; justify-content:space-between; }
        .fs-lab-col .tag { font-size:10.5px; padding:2px 8px; border-radius:10px; }
        .tag.generic { background:rgba(146,175,166,0.15); color:var(--sage); }
        .tag.special { background:rgba(201,162,39,0.15); color:var(--gold); }
        .fs-lab-out { background:var(--panel2); border:1px solid var(--line); border-radius:3px; padding:14px; font-size:13px; line-height:1.6; min-height:180px; white-space:pre-wrap; }
        .fs-empty { color:var(--sage); font-size:13.5px; padding:30px 0; }
        .fs-spin { animation: fs-spin 0.9s linear infinite; }
        @keyframes fs-spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        @media (max-width:820px) {
          .fs-body { flex-direction:column; }
          .fs-nav { width:100%; display:flex; overflow-x:auto; border-right:none; border-bottom:1px solid var(--line); }
          .fs-nav-item { flex-direction:column; align-items:flex-start; white-space:nowrap; }
          .fs-fields, .fs-health, .fs-lab-grid { grid-template-columns:1fr; }
        }
      `}</style>
 
      <div className="fs-header">
        <div className="fs-brand">
          <h1>FinSim</h1>
          <span>a decision simulator, not a calculator</span>
        </div>
        {profile && (
          <div className="fs-vitals">
            <div className="fs-vital"><small>Monthly surplus</small><strong>{inr(baseSim.surplus)}</strong></div>
            <div className="fs-vital"><small>Savings</small><strong>{inr(profile.savings)}</strong></div>
            <div className="fs-vital"><small>Horizon</small><strong>{profile.horizon} mo</strong></div>
          </div>
        )}
      </div>
 
      <div className="fs-body">
        <div className="fs-nav">
          {STAGES.map((s, i) => {
            const Icon = s.icon;
            const locked = !canGo(i);
            return (
              <div
                key={s.id}
                className={"fs-nav-item" + (stage === i ? " active" : "") + (locked ? " locked" : "")}
                onClick={() => !locked && setStage(i)}
              >
                <span className="fs-navnum">{String(i + 1).padStart(2, "0")}</span>
                <Icon />
                <div>
                  <span className="fs-navlabel">{s.label}</span>
                  <span className="fs-navsub">{s.sub}</span>
                </div>
              </div>
            );
          })}
        </div>
 
        <div className="fs-main">
          {stage === 0 && (
            <StageShell eyebrow="01 · Smart Financial Profile" title="Describe your decision, and the agent checks it with you">
              <div className="fs-panel">
                {!chatStarted ? (
                  <>
                    <textarea className="fs-input" value={raw} onChange={(e) => setRaw(e.target.value)} />
                    <button className="fs-btn" onClick={startClarifier}>
                      <Sparkles size={15} />Check with AI<ArrowRight size={15} />
                    </button>
                    <button className="fs-btn ghost" onClick={useManualProfile} style={{ marginLeft: 10 }}>
                      Use example numbers instead
                    </button>
                  </>
                ) : (
                  <>
                    <div className="fs-chat">
                      {chatMessages.map((m, i) => (
                        <div key={i} className={"fs-chat-bubble " + m.role}>
                          <b>{m.role === "user" ? "You" : "Clarifier agent"}</b>
                          {m.text}
                        </div>
                      ))}
                      {chatRunning && (
                        <div className="fs-chat-bubble assistant fs-chat-typing">
                          <b>Clarifier agent</b>
                          <Loader2 className="fs-spin" size={13} /> thinking…
                        </div>
                      )}
                    </div>
                    {chatErr && <div className="fs-err"><CircleAlert />{chatErr}</div>}
 
                    {!chatDone ? (
                      <div className="fs-chat-input-row">
                        <input
                          className="fs-chat-input"
                          value={chatInput}
                          placeholder="Answer the agent's question…"
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && sendChatReply()}
                        />
                        <button className="fs-btn" disabled={chatRunning} onClick={sendChatReply}>
                          Send<ArrowRight size={15} />
                        </button>
                      </div>
                    ) : (
                      <button className="fs-btn" onClick={() => applyExtraction(chatProfile)}>
                        <CircleCheck size={15} />Build my profile<ArrowRight size={15} />
                      </button>
                    )}
                    <button
                      className="fs-btn ghost"
                      style={{ marginTop: 10 }}
                      onClick={() => {
                        setChatStarted(false);
                        setChatMessages([]);
                        setChatProfile({ income: null, savings: null, expenses: null, price: null, horizon: null, goal: null });
                        setChatMissing([]);
                        setChatDone(false);
                        setChatInput("");
                        setChatErr("");
                        setProfile(null);
                        setMissing([]);
                      }}
                    >
                      <RotateCcw size={14} />Start over
                    </button>
                  </>
                )}
 
                {profile && (
                  <>
                    <div className="fs-fields">
                      <Field label="Monthly income" prefix="₹" value={profile.income} onChange={(v) => setProfile({ ...profile, income: v })} />
                      <Field label="Current savings" prefix="₹" value={profile.savings} onChange={(v) => setProfile({ ...profile, savings: v })} />
                      <Field label="Monthly expenses" prefix="₹" value={profile.expenses} onChange={(v) => setProfile({ ...profile, expenses: v })} />
                      <Field label="Purchase cost" prefix="₹" value={profile.price} onChange={(v) => setProfile({ ...profile, price: v })} />
                      <Field label="Time horizon (months)" value={profile.horizon} onChange={(v) => setProfile({ ...profile, horizon: v })} />
                    </div>
                    {missing.length > 0 && (
                      <div className="fs-missing">
                        Still unconfirmed: <strong>{missing.join(", ")}</strong> — a placeholder was used. Correct the fields above rather than trusting a guess.
                      </div>
                    )}
                    <div className="fs-health">
                      <div><small>Monthly surplus</small><strong>{inr(baseSim.surplus)}</strong></div>
                      <div><small>Savings rate</small><strong>{Math.round((baseSim.surplus / profile.income) * 100)}%</strong></div>
                      <div><small>6-mo emergency target</small><strong>{inr(baseSim.emergencyTarget)}</strong></div>
                      <div><small>Reserve after buying now</small>
                        <strong style={{ color: profile.savings - profile.price < baseSim.emergencyTarget ? "var(--coral)" : "var(--mint)" }}>
                          {inr(profile.savings - profile.price)}
                        </strong>
                      </div>
                    </div>
                    <button className="fs-btn" onClick={() => setStage(1)} style={{ marginTop: 18 }}>
                      Continue to scenarios<ArrowRight size={15} />
                    </button>
                  </>
                )}
              </div>
            </StageShell>
          )}
 
          {stage === 1 && profile && (
            <StageShell eyebrow="02 · Scenario Generator + Simulation Engine" title="Five futures, calculated deterministically">
              <div className="fs-panel">
                <div className="fs-legend-row">
                  {SCENARIO_META.map((s) => (
                    <div className="fs-legend-chip" key={s.key}>
                      <span className="fs-legend-dot" style={{ background: s.color }} />{s.label}
                    </div>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={baseSim.rows}>
                    <CartesianGrid stroke="#24463F" strokeDasharray="2 4" />
                    <XAxis dataKey="month" stroke="#92AFA6" tick={{ fontSize: 12 }} />
                    <YAxis stroke="#92AFA6" tick={{ fontSize: 11 }} tickFormatter={(v) => "₹" + (v / 1000) + "k"} />
                    <Tooltip contentStyle={{ background: "#0F2621", border: "1px solid #24463F", fontSize: 12 }} formatter={(v) => inr(v)} />
                    {SCENARIO_META.map((s) => (
                      <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                <table className="fs-table">
                  <thead><tr><th>Scenario</th><th>Ends with</th><th>Note</th></tr></thead>
                  <tbody>
                    <tr><td>Buy Now</td><td>{inr(baseSim.final.buyNow)}</td><td>Reserve drops immediately by {inr(profile.price)}</td></tr>
                    <tr><td>Save First</td><td>{inr(baseSim.final.saveFirst)}</td><td>{baseSim.saveFirstBoughtAt ? `Purchase completed month ${baseSim.saveFirstBoughtAt}` : "Not affordable within horizon"}</td></tr>
                    <tr><td>Budget Option</td><td>{inr(baseSim.final.budget)}</td><td>Cheaper item at {inr(baseSim.budgetPrice)}</td></tr>
                    <tr><td>EMI</td><td>{inr(baseSim.final.emi)}</td><td>{inr(baseSim.emi)}/mo over {baseSim.emiMonths} months at 12% p.a.</td></tr>
                    <tr><td>Delay</td><td>{inr(baseSim.final.delay)}</td><td>Full surplus redirected to other goals</td></tr>
                  </tbody>
                </table>
                <button className="fs-btn" disabled={debating} onClick={runDebate}>
                  {debating ? <Loader2 className="fs-spin" size={15} /> : <ShieldAlert size={15} />}
                  {debating ? "Agents debating…" : "Run planner vs critic debate"}
                  {!debating && <ArrowRight size={15} />}
                </button>
                {debateErr && <div className="fs-err"><CircleAlert />{debateErr}</div>}
              </div>
            </StageShell>
          )}
 
          {stage === 2 && (
            debate ? (
              <StageShell eyebrow="03 · Adversarial Planner–Critic Loop" title="Two agents argue it out">
                <div className="fs-panel">
                  <div className="fs-debate">
                    <div className="fs-bubble planner"><b>Planner agent</b>{debate.planner}</div>
                    <div className="fs-bubble critic"><b>Critic agent</b>{debate.critic}</div>
                    <div className="fs-bubble revised"><b>Planner, revised</b>{debate.revised}</div>
                  </div>
                  <button className="fs-btn" onClick={() => setStage(3)} style={{ marginTop: 22 }}>
                    Continue to what-if testing<ArrowRight size={15} />
                  </button>
                </div>
              </StageShell>
            ) : (
              <div className="fs-empty">Run the debate from the Scenarios stage first.</div>
            )
          )}
 
          {stage === 3 && profile && (
            <StageShell eyebrow="04 · What-If Sensitivity Panel" title="Stress-test the plan live">
              <div className="fs-panel">
                <div className="fs-sliders">
                  <div className="fs-slider">
                    <label>Salary change <strong>{overrides.incomeDeltaPct > 0 ? "+" : ""}{overrides.incomeDeltaPct}%</strong></label>
                    <input type="range" min={-30} max={30} value={overrides.incomeDeltaPct} onChange={(e) => setOverrides({ ...overrides, incomeDeltaPct: Number(e.target.value) })} />
                  </div>
                  <div className="fs-slider">
                    <label>Extra monthly expense <strong>{inr(overrides.expenseDelta)}</strong></label>
                    <input type="range" min={0} max={15000} step={500} value={overrides.expenseDelta} onChange={(e) => setOverrides({ ...overrides, expenseDelta: Number(e.target.value) })} />
                  </div>
                  <div className="fs-slider">
                    <label>Purchase price change <strong>{overrides.priceDelta >= 0 ? "+" : ""}{inr(overrides.priceDelta)}</strong></label>
                    <input type="range" min={-40000} max={40000} step={1000} value={overrides.priceDelta} onChange={(e) => setOverrides({ ...overrides, priceDelta: Number(e.target.value) })} />
                  </div>
                  <button className="fs-btn ghost" onClick={() => setOverrides({ incomeDeltaPct: 0, expenseDelta: 0, priceDelta: 0 })}>
                    <RotateCcw size={14} />Reset assumptions
                  </button>
                </div>
 
                <ResponsiveContainer width="100%" height={280} style={{ marginTop: 22 }}>
                  <LineChart data={liveSim.rows}>
                    <CartesianGrid stroke="#24463F" strokeDasharray="2 4" />
                    <XAxis dataKey="month" stroke="#92AFA6" tick={{ fontSize: 12 }} />
                    <YAxis stroke="#92AFA6" tick={{ fontSize: 11 }} tickFormatter={(v) => "₹" + (v / 1000) + "k"} />
                    <Tooltip contentStyle={{ background: "#0F2621", border: "1px solid #24463F", fontSize: 12 }} formatter={(v) => inr(v)} />
                    {SCENARIO_META.map((s) => (
                      <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
 
                <div className="fs-break">
                  <CircleAlert size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />
                  Expenses can rise by up to <strong className="fs-num">{inr(breakpoint)}</strong>/mo before "Save First" no longer completes within {profile.horizon} months.
                </div>
 
                <button className="fs-btn" disabled={verdicting} onClick={runVerdict} style={{ marginTop: 18 }}>
                  {verdicting ? <Loader2 className="fs-spin" size={15} /> : <Stamp size={15} />}
                  {verdicting ? "Weighing options…" : "Generate final recommendation"}
                  {!verdicting && <ArrowRight size={15} />}
                </button>
                {verdictErr && <div className="fs-err"><CircleAlert />{verdictErr}</div>}
              </div>
            </StageShell>
          )}
 
          {stage === 4 && (
            verdict ? (
              <StageShell eyebrow="05 · Explainable Recommendation" title="The verdict">
                <div className="fs-verdict">
                  <span className="fs-verdict-tag">Recommended</span>
                  <h3>{verdict.recommended}</h3>
                  <ul>{verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  <p style={{ fontSize: 13.5, color: "var(--sage)" }}><strong style={{ color: "var(--ivory)" }}>Trade-off — </strong>{verdict.tradeoff}</p>
                  <p style={{ fontSize: 13.5, color: "var(--sage)" }}><strong style={{ color: "var(--ivory)" }}>Breaks if — </strong>{verdict.breakStatement}</p>
                  <div className="fs-conf">
                    <CircleCheck size={15} color="var(--mint)" />
                    Confidence: <strong style={{ color: "var(--ivory)" }}>{verdict.confidence}</strong>
                  </div>
                </div>
              </StageShell>
            ) : (
              <div className="fs-empty">Generate a recommendation from the What-If stage first.</div>
            )
          )}
 
          {stage === 5 && (
            <StageShell eyebrow="06 · Prompt Lab" title="Generic prompt vs specialized agent, side by side">
              <div className="fs-panel">
                <textarea className="fs-input" value={labQuery} onChange={(e) => setLabQuery(e.target.value)} style={{ minHeight: 60 }} />
                <button className="fs-btn" disabled={labRunning} onClick={runPromptLab}>
                  {labRunning ? <Loader2 className="fs-spin" size={15} /> : <FlaskConical size={15} />}
                  {labRunning ? "Running both prompts…" : "Run comparison"}
                </button>
                {labErr && <div className="fs-err"><CircleAlert />{labErr}</div>}
                <div className="fs-lab-grid">
                  <div className="fs-lab-col">
                    <h4>Generic assistant prompt<span className="tag generic">baseline</span></h4>
                    <div className="fs-lab-out">{labGeneric || "—"}</div>
                  </div>
                  <div className="fs-lab-col">
                    <h4>Specialized Risk Analyst agent<span className="tag special">FinSim</span></h4>
                    <div className="fs-lab-out">{labSpecial || "—"}</div>
                  </div>
                </div>
              </div>
            </StageShell>
          )}
 
          {stage > 0 && !profile && (
            <div className="fs-empty">Extract a profile in stage 01 first.</div>
          )}
        </div>
      </div>
    </div>
  );
}
 