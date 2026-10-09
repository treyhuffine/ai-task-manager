import { Suspense } from 'react';
import { FinanceApp } from '@/components/finance/finance-app';
import {headers} from 'next/headers';
import {authenticateToken,requestToken} from '@/lib/auth';
import {redirect} from 'next/navigation';
export default async function FinancePage() {
  const h=await headers();
  const principal=authenticateToken(requestToken(new Request('http://localhost',{headers:h})));
  if(!principal?.owner)redirect('/login');
  return (
    <Suspense fallback={<p className="p-6">Loading finance...</p>}>
      <FinanceApp />
    </Suspense>
  );
}
