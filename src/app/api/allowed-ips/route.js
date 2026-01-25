import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';

export async function GET() {
  try {
    const q = query(collection(db, 'allowedIPs'), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    const ips = [];
    querySnapshot.forEach((doc) => {
      ips.push(doc.data().ip);
    });
    
    return NextResponse.json({ allowedIPs: ips });
  } catch (error) {
    console.error('Error fetching allowed IPs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch allowed IPs' },
      { status: 500 }
    );
  }
}

