import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import IPCheckWrapper from "@/components/IPCheckWrapper";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "SOC Alerts Converter",
  description: "Convert JSON alert data to formatted text output",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <IPCheckWrapper>
        {children}
        </IPCheckWrapper>
      </body>
    </html>
  );
}
