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

        {/* iOS Safari keeps the page zoomed after input blur — snap the
            viewport back to 1:1 as a safety net (inputs are >=16px so the
            focus zoom should not trigger in the first place). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(!/iPhone|iPad|iPod/i.test(navigator.userAgent))return;var v=document.querySelector('meta[name="viewport"]');if(!v)return;var base='width=device-width, initial-scale=1, shrink-to-fit=no';document.addEventListener('focusout',function(){if(window.visualViewport&&window.visualViewport.scale>1){v.setAttribute('content',base+', maximum-scale=1');setTimeout(function(){v.setAttribute('content',base)},120)}})})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
