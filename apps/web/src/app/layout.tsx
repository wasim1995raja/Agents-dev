import type { Metadata } from "next";
import Link from "next/link";

import { RuntimeStatus } from "@/components/RuntimeStatus";

import "./globals.css";

export const metadata: Metadata = {
  title: "AutoDev Agent — autonomous software delivery",
  description:
    "Describe an application, pick a stack, and watch manager and specialist agents plan, build, test, review and prepare it for deployment.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="shell">
            <Link className="brand" href="/">
              <span className="brand-mark" aria-hidden="true">
                AD
              </span>
              <span className="brand-copy">
                <span className="brand-name">AutoDev Agent</span>
                <span className="brand-sub">Autonomous delivery</span>
              </span>
            </Link>
            <RuntimeStatus />
          </div>
        </header>

        <main>{children}</main>

        <footer className="footer">
          <div className="shell">
            <span>AutoDev Agent · owner-approved autonomous delivery</span>
            <span>
              Runs happen in per-project Docker containers. Destructive commands and
              production deploys require explicit approval.
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
