import type { ReactNode } from "react";

export const metadata = {
  title: "chemag reference admin",
  description: "Reference monorepo for the chemag toolkit",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
