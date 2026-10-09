import type {Metadata} from 'next';
import {Providers} from './providers';
import './globals.css';
export const metadata:Metadata={title:'Finances',description:'An independent app for budgets, spending and purchase evidence'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><Providers>{children}</Providers></body></html>;}
