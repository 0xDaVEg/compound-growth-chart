import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />

        {/* PWA manifest — relative so it works under any base path */}
        <link rel="manifest" href="manifest.json" />

        {/* iOS PWA */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Calc" />
        <link rel="apple-touch-icon" href="icon.png" />

        {/* Theme */}
        <meta name="theme-color" content="#1a2d5a" />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
