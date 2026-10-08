"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function Shell({ children, projectId, projectName, page, testName, testHref }: { children: React.ReactNode; projectId?: string; projectName?: string; page: string; testName?: string; testHref?: string }) {
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    const saved = localStorage.getItem("probator-theme") ?? "light";
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("probator-theme", next);
    setTheme(next);
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/">probator<span>.</span></Link>
      <div className="workspace"><span className="avatar">P</span><div><strong>Workspace locale</strong><small>Ambiente di sviluppo</small></div></div>
      <div className="nav-label">Workspace</div><Link className={`nav-link ${page === "projects" ? "selected" : ""}`} href="/">▦ <span>Progetti</span></Link>
      {projectId && <><div className="nav-label nav-spaced">Progetto attivo</div><div className="active-project"><span className="avatar">{projectName?.slice(0, 1) ?? "P"}</span><strong>{projectName ?? "Progetto"}</strong></div><Link className={`nav-link ${page === "board" ? "selected" : ""}`} href={`/projects/${projectId}`}>▤ <span>Board dei test</span></Link><Link className={`nav-link ${page === "history" ? "selected" : ""}`} href={`/projects/${projectId}/history`}>◷ <span>Esecuzioni</span></Link></>}
      <div className="sidebar-bottom"><span className="muted">Browser worker</span><span className="worker-pill">● Da verificare</span><small>Live · locale</small></div>
    </aside>
    <div className="main-frame"><header className="topbar"><details className="mobile-nav"><summary aria-label="Apri navigazione">☰</summary><nav><Link href="/">Progetti</Link>{projectId && <><Link href={`/projects/${projectId}`}>Board dei test</Link><Link href={`/projects/${projectId}/history`}>Esecuzioni</Link></>}</nav></details><div><Link href="/">Workspace</Link>{projectId && <> <span>/</span> <strong>{projectName ?? "Progetto"}</strong>{page !== "board" && <>{page === "execution" && testHref ? <> <span>/</span> <Link className="breadcrumb-link" href={testHref}>{testName ?? "Test"}</Link></> : null} <span>/</span> <strong>{page === "history" ? "Esecuzioni" : page === "execution" ? "Dettaglio esecuzione" : page === "recording" ? "Registrazione" : page}</strong></>}</>}</div><div className="top-actions"><span>Workspace locale</span><button className="icon-button" onClick={toggleTheme} aria-label={theme === "light" ? "Attiva tema scuro" : "Attiva tema chiaro"}>{theme === "light" ? "◐" : "☼"}</button></div></header><main>{children}</main></div>
  </div>;
}

export function PageHeading({ title, description, children }: { title: string; description: React.ReactNode; children?: React.ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{children}</div></div>;
}

export function Notice({ children, kind = "info" }: { children: React.ReactNode; kind?: "info" | "error" }) { return <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>; }
