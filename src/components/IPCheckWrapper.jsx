'use client';

import dynamic from 'next/dynamic';

const IPChecker = dynamic(() => import('@/components/IPChecker'), {
  ssr: false,
});

export default function IPCheckWrapper({ children }) {
  return <IPChecker>{children}</IPChecker>;
}

