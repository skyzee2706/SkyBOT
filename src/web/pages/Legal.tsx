import { useEffect, type ReactNode } from "react";
import { setPageTitle } from "../api";

const UPDATED = "September 27, 2026";
const CONTACT = (
  <a href="https://x.com/SkyzeeReal" target="_blank" rel="noreferrer" className="text-brand-300 hover:underline">
    @SkyzeeReal on X
  </a>
);

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    setPageTitle(title);
    return () => setPageTitle();
  }, [title]);
  return (
    <article className="mx-auto max-w-3xl space-y-6 text-sm leading-relaxed text-zinc-300 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_li]:ml-5 [&_li]:list-disc">
      <header>
        <h1 className="text-3xl font-bold text-zinc-100">{title}</h1>
        <p className="mt-1 text-xs text-zinc-500">Last updated {UPDATED}</p>
      </header>
      {children}
    </article>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        SkyBOT Raffle ("SkyBOT", "we") runs raffles for Discord communities. This page explains what we store, who can see
        it and how to remove it.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Your Discord user ID, username and avatar when you log in or enter a raffle.</li>
        <li>A Discord access token for your login session (encrypted, deleted when the session expires).</li>
        <li>Wallet addresses you save or submit, and the X (Twitter) username and user ID you connect.</li>
        <li>Quote-post links you submit for X tasks, and which task links you opened.</li>
        <li>Your raffle entries and results.</li>
      </ul>
      <p>We do not store passwords, private keys, seed phrases, emails or payment details, and we never ask for them.</p>

      <h2>Who can see it</h2>
      <ul>
        <li>
          <b>Everyone:</b> your Discord username and avatar in the participant list of raffles you entered, and whether you
          won.
        </li>
        <li>
          <b>The raffle's host and managers:</b> your Discord ID, wallet, X username and quote links for their raffle, so they
          can deliver allowlist spots. They may export winners to a spreadsheet.
        </li>
        <li>We do not sell your data or share it with advertisers.</li>
      </ul>

      <h2>Services we use</h2>
      <p>
        Data is hosted on Vercel (application) and Neon (database), and draws are scheduled with Upstash. We use Discord and
        X only to log you in and check raffle requirements.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Remove a saved wallet or disconnect X at any time from the account menu (top right).</li>
        <li>Log out to end your session immediately.</li>
        <li>To delete everything we store about you, contact {CONTACT}. Entries in finished raffles may be kept as a record of the result.</li>
      </ul>

      <h2>Changes</h2>
      <p>We will update this page when our data practices change. The date at the top shows the latest version.</p>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of Use">
      <p>By using SkyBOT Raffle you agree to these terms.</p>

      <h2>The service</h2>
      <ul>
        <li>SkyBOT lets communities run raffles for allowlist spots and lets people enter them. It is free and provided "as is".</li>
        <li>Hosts decide the prizes, rules and requirements of their raffles and are responsible for delivering what they promise. SkyBOT does not hold or guarantee any prize.</li>
        <li>Winners are drawn at random when a raffle ends. Hosts may disqualify participants who break their rules; a replacement winner is then drawn automatically.</li>
      </ul>

      <h2>Your responsibilities</h2>
      <ul>
        <li>One entry per person. Do not use multiple accounts, bots or other people's wallets or X accounts.</li>
        <li>Only submit wallets you own. SkyBOT never asks for private keys or seed phrases. Anyone who does is a scammer.</li>
        <li>Do not abuse the service, try to break it, or use it for anything illegal.</li>
      </ul>

      <h2>X tasks</h2>
      <p>
        SkyBOT records that you opened each X task link but cannot verify that you completed the action. Hosts may check
        winners manually.
      </p>

      <h2>Limits</h2>
      <p>
        SkyBOT is not responsible for losses caused by hosts, projects, third-party services (Discord, X, blockchains) or
        downtime. We may remove raffles or block accounts that abuse the service.
      </p>

      <h2>Contact</h2>
      <p>Questions: {CONTACT}.</p>
    </LegalPage>
  );
}
