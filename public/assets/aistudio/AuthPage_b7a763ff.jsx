import { useState } from "react";

/* ------------------------------------------------------------------
   AuthPage – animated Login / Sign-up for 4 roles
   Roles: member | merchant | lender | admin
   Wire your backend in the two handlers passed as props:
     onLogin({ role, identifier, password })     -> Promise
     onRegister({ role, name, email, password }) -> Promise
   Throw an Error(message) from either to show it under the form.
------------------------------------------------------------------- */

export const ROLES = {
  member:   { label: "Member",   nameLabel: "Full name",        canRegister: true,
              loginTitle: "Welcome back!", loginText: "Pick up where you left off and check your balance, repayments and rewards.",
              regTitle: "Join the circle", regText: "Create a member account to save, borrow and shop with trusted merchants." },
  merchant: { label: "Merchant", nameLabel: "Business name",    canRegister: true,
              loginTitle: "Good to see you", loginText: "Manage your store, orders and settlements in one place.",
              regTitle: "Grow your store", regText: "Register your business to accept members and get paid faster." },
  lender:   { label: "Lender",   nameLabel: "Institution name", canRegister: true,
              loginTitle: "Welcome back", loginText: "Review applications, portfolio performance and repayments.",
              regTitle: "Fund with confidence", regText: "Register as a lender to reach verified members and merchants." },
  admin:    { label: "Admin",    nameLabel: "",                 canRegister: false,
              loginTitle: "Admin console", loginText: "Restricted access. Admin accounts are created by invitation only.",
              regTitle: "", regText: "" },
};

// Where each role lands after login – change to your routes
export const ROLE_ROUTES = {
  member: "/member", merchant: "/merchant", lender: "/lender", admin: "/admin",
};

const UserIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5Z"/></svg>
);
const MailIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 8L4 7.5V8l8 5.5L20 8v-.5Z"/></svg>
);
const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9Zm-8-2a3 3 0 0 1 6 0v2H9Z"/></svg>
);

function Field({ id, label, type = "text", icon, value, onChange, autoComplete }) {
  return (
    <div className="ax-field">
      <input id={id} type={type} value={value} onChange={onChange}
             placeholder=" " required autoComplete={autoComplete} />
      <label htmlFor={id}>{label}</label>
      <span className="ax-icon">{icon}</span>
    </div>
  );
}

export default function AuthPage({
  onLogin = async (p) => console.log("login", p),
  onRegister = async (p) => console.log("register", p),
  initialRole = "member",
}) {
  const [role, setRole] = useState(initialRole);
  const [mode, setMode] = useState("login"); // login | register
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [login, setLogin] = useState({ identifier: "", password: "" });
  const [reg, setReg] = useState({ name: "", email: "", password: "" });

  const cfg = ROLES[role];
  const active = mode === "register" && cfg.canRegister;

  const pickRole = (r) => {
    setRole(r);
    setError(""); setNotice("");
    if (!ROLES[r].canRegister) setMode("login");
  };
  const switchMode = (m) => { setError(""); setNotice(""); setMode(m); };

  const submit = (handler, payload) => async (e) => {
    e.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await handler({ role, ...payload });
      if (res?.notice) { setNotice(res.notice); if (res.switchToLogin) setMode("login"); }
    }
    catch (err) { setError(err?.message || "Something went wrong. Try again."); }
    finally { setBusy(false); }
  };

  return (
    <main className="ax-page">
      <style>{css}</style>

      <div className={`ax-box ${active ? "is-active" : ""}`}>
        <div className="ax-diagonal" aria-hidden="true" />

        {/* Role picker – shared by both forms */}
        <div className="ax-roles" role="tablist" aria-label="Account type">
          {Object.entries(ROLES).map(([key, r]) => (
            <button key={key} type="button" role="tab" aria-selected={role === key}
                    className={role === key ? "on" : ""} onClick={() => pickRole(key)}>
              {r.label}
            </button>
          ))}
        </div>

        {/* LOGIN */}
        <form className="ax-form ax-login" onSubmit={submit(onLogin, login)} aria-hidden={active}>
          <h1 className="ax-anim" style={{ "--li": 0 }}>{cfg.label} login</h1>
          <div className="ax-anim" style={{ "--li": 1 }}>
            <Field id="l-id" label="Email" type="email" icon={<MailIcon />} autoComplete="email"
                   value={login.identifier} onChange={(e) => setLogin({ ...login, identifier: e.target.value })} />
          </div>
          <div className="ax-anim" style={{ "--li": 2 }}>
            <Field id="l-pw" label="Password" type="password" icon={<LockIcon />} autoComplete="current-password"
                   value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} />
          </div>
          <div className="ax-anim" style={{ "--li": 3 }}>
            <button className="ax-btn" disabled={busy}>{busy && !active ? "Logging in…" : "Log in"}</button>
          </div>
          {error && !active && <p className="ax-error" role="alert">{error}</p>}
          {notice && !active && <p className="ax-notice" role="status">{notice}</p>}
          <p className="ax-alt ax-anim" style={{ "--li": 4 }}>
            {cfg.canRegister
              ? <>No account yet? <button type="button" onClick={() => switchMode("register")}>Sign up</button></>
              : "Admin accounts are created by invitation."}
          </p>
        </form>

        {/* REGISTER */}
        <form className="ax-form ax-register" onSubmit={submit(onRegister, reg)} aria-hidden={!active}>
          <h1 className="ax-anim" style={{ "--li": 0 }}>{cfg.label} sign-up</h1>
          <div className="ax-anim" style={{ "--li": 1 }}>
            <Field id="r-name" label={cfg.nameLabel || "Name"} icon={<UserIcon />} autoComplete="name"
                   value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} />
          </div>
          <div className="ax-anim" style={{ "--li": 2 }}>
            <Field id="r-mail" label="Email" type="email" icon={<MailIcon />} autoComplete="email"
                   value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} />
          </div>
          <div className="ax-anim" style={{ "--li": 3 }}>
            <Field id="r-pw" label="Password" type="password" icon={<LockIcon />} autoComplete="new-password"
                   value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} />
          </div>
          <div className="ax-anim" style={{ "--li": 4 }}>
            <button className="ax-btn" disabled={busy}>{busy && active ? "Creating account…" : "Create account"}</button>
          </div>
          {error && active && <p className="ax-error" role="alert">{error}</p>}
          <p className="ax-alt ax-anim" style={{ "--li": 5 }}>
            Already registered? <button type="button" onClick={() => switchMode("login")}>Log in</button>
          </p>
        </form>

        {/* Info panels sitting on the orange diagonal */}
        <aside className="ax-info ax-info-login">
          <h2>{cfg.loginTitle}</h2><p>{cfg.loginText}</p>
        </aside>
        <aside className="ax-info ax-info-register">
          <h2>{cfg.regTitle || cfg.loginTitle}</h2><p>{cfg.regText || cfg.loginText}</p>
        </aside>
      </div>
    </main>
  );
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
.ax-page{--bg:#ffffff;--ink:#12301f;--mute:#5f7366;--o1:#15803d;--o2:#0a4d27;--g3:#22b25a;
  min-height:100vh;display:grid;place-items:center;padding:24px;background:#e9f5ee;
  font-family:'Poppins',system-ui,sans-serif;color:var(--ink)}
.ax-box{position:relative;width:min(900px,100%);height:600px;background:var(--bg);overflow:hidden;
  border:2px solid var(--o1);box-shadow:0 0 26px rgba(21,128,61,.35),inset 0 0 22px rgba(34,178,90,.10)}
.ax-diagonal{position:absolute;inset:0;background:linear-gradient(135deg,var(--o2),var(--g3));
  clip-path:polygon(45% 0,100% 0,100% 100%,78% 100%);transition:clip-path .9s ease}
.is-active .ax-diagonal{clip-path:polygon(0 0,55% 0,22% 100%,0 100%)}

.ax-roles{position:absolute;z-index:3;top:22px;left:50%;transform:translateX(-50%);display:flex;gap:4px;
  padding:4px;background:#fff;border:1px solid #cfe3d6;box-shadow:0 2px 10px rgba(10,77,39,.15);border-radius:999px}
.ax-roles button{border:0;background:none;color:var(--mute);font:500 12.5px 'Poppins',sans-serif;
  padding:7px 14px;border-radius:999px;cursor:pointer;transition:.25s}
.ax-roles button:hover{color:var(--o1)}
.ax-roles button.on{background:linear-gradient(90deg,var(--o2),var(--o1));color:#fff}
.ax-roles button:focus-visible,.ax-btn:focus-visible,.ax-alt button:focus-visible{outline:2px solid var(--o1);outline-offset:2px}

.ax-form{position:absolute;top:0;width:50%;height:100%;display:flex;flex-direction:column;justify-content:center;
  padding:70px 48px 24px;z-index:2}
.ax-login{left:0}
.ax-register{right:0}
.ax-form h1{font-size:28px;font-weight:600;text-align:center;margin:0 0 18px}

/* the staggered slide / blur animation from the reference */
.ax-anim{transition:transform .7s ease,opacity .7s ease,filter .7s ease;
  transition-delay:calc(.1s * var(--li,0));}
.ax-login .ax-anim{transform:translateX(0);opacity:1;filter:none}
.ax-register .ax-anim{transform:translateX(120%);opacity:0;filter:blur(10px);transition-delay:0s}
.is-active .ax-login .ax-anim{transform:translateX(-120%);opacity:0;filter:blur(10px);transition-delay:0s}
.is-active .ax-register .ax-anim{transform:translateX(0);opacity:1;filter:none;
  transition-delay:calc(.35s + .1s * var(--li,0))}
.ax-login:not([aria-hidden="true"]) .ax-anim{transition-delay:calc(.35s + .1s * var(--li,0))}
.ax-form[aria-hidden="true"]{pointer-events:none}

.ax-field{position:relative;margin:20px 0}
.ax-field input{width:100%;background:none;border:0;border-bottom:2px solid #c3d3c9;color:var(--ink);
  font:500 15px 'Poppins',sans-serif;padding:10px 30px 8px 0;outline:0;transition:border-color .3s}
.ax-field input:focus{border-color:var(--o1)}
.ax-field label{position:absolute;left:0;top:10px;font-size:14px;color:var(--ink);pointer-events:none;transition:.3s}
.ax-field input:focus + label,.ax-field input:not(:placeholder-shown) + label{top:-14px;font-size:12px;color:var(--o1)}
.ax-icon{position:absolute;right:0;top:10px;color:#8aa093;display:flex}
.ax-field input:focus ~ .ax-icon{color:var(--o1)}

.ax-btn{width:100%;margin-top:8px;padding:12px;border:2px solid var(--o1);border-radius:999px;cursor:pointer;
  font:600 15px 'Poppins',sans-serif;color:#fff;background:linear-gradient(90deg,var(--o2),var(--o1));
  box-shadow:0 4px 14px rgba(21,128,61,.30);transition:box-shadow .3s,transform .2s}
.ax-btn:hover:not(:disabled){box-shadow:0 6px 20px rgba(21,128,61,.5)}
.ax-btn:disabled{opacity:.6;cursor:wait}
.ax-alt{text-align:center;font-size:13px;margin:18px 0 0;color:var(--mute)}
.ax-alt button{background:none;border:0;color:var(--o1);font:600 13px 'Poppins',sans-serif;cursor:pointer;padding:0}
.ax-alt button:hover{text-decoration:underline}
.ax-notice{margin:12px 0 0;font-size:13px;text-align:center;color:#0a4d27;font-weight:500}
.ax-error{margin:12px 0 0;font-size:13px;text-align:center;color:#b42318}

.ax-info{position:absolute;z-index:2;width:42%;top:50%;transform:translateY(-50%);transition:opacity .6s,transform .8s}
.ax-info h2{color:#fff;font-size:32px;line-height:1.15;margin:0 0 12px;font-weight:700}
.ax-info p{font-size:14px;line-height:1.55;margin:0;color:#fff;opacity:.92}
.ax-info-login{right:36px;text-align:right}
.ax-info-register{left:36px;text-align:left;opacity:0;transform:translateY(-50%) translateX(-60px);pointer-events:none}
.is-active .ax-info-login{opacity:0;transform:translateY(-50%) translateX(60px)}
.is-active .ax-info-register{opacity:1;transform:translateY(-50%);transition-delay:.4s}

@media (max-width:720px){
  .ax-box{height:auto;min-height:640px;border-width:1px}
  .ax-diagonal,.ax-info{display:none}
  .ax-roles{left:16px;right:16px;transform:none;justify-content:space-between}
  .ax-roles button{flex:1;padding:7px 4px}
  .ax-form{width:100%;padding:90px 28px 28px}
  .ax-register{display:none}
  .is-active .ax-register{display:flex}
  .is-active .ax-login{display:none}
  .ax-login .ax-anim,.ax-register .ax-anim,.is-active .ax-register .ax-anim{transform:none;opacity:1;filter:none}
}
@media (prefers-reduced-motion:reduce){
  .ax-anim,.ax-diagonal,.ax-info{transition:none!important}
}
`;
