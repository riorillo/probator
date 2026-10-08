import type { Metadata } from "next";
import "./style.css";
import "rrweb/dist/style.css";

export const metadata: Metadata = { title: "Probator", description: "Manage and run web application tests." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="it"><body>{children}</body></html>;
}
