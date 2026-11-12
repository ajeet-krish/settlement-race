import type { ReactNode } from "react";
import TabNav from "./TabNav";
import type { TabId } from "./tabs";

interface AppShellProps {
    active: TabId;
    onTabChange: (id: TabId) => void;
    children: ReactNode;
}

/**
 * Application chrome: identity and hook line, devnet badge, the two lane
 * keyline, the tab strip, and the main region that hosts the active
 * panel. Panel content is owned by App and passed through as children.
 */
export default function AppShell({
    active,
    onTabChange,
    children,
}: AppShellProps) {
    return (
        <div className="shell">
            <header className="shell-topbar">
                <div className="shell-identity">
                    <h1 className="shell-name">Settlement Race</h1>
                    <p className="shell-hook">
                        Two settlement paths race. One carries risk. The other
                        cannot.
                    </p>
                    <p className="badge">Devnet play money only</p>
                </div>
                <div className="lane-keyline" aria-hidden="true">
                    <span className="lane-keyline-seq" />
                    <span className="lane-keyline-atomic" />
                </div>
                <TabNav active={active} onChange={onTabChange} />
            </header>
            <main className="shell-main">{children}</main>
        </div>
    );
}
