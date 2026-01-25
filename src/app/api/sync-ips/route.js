import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';

// This endpoint can be called to sync IPs to environment variables
// In production, you might want to use Vercel Edge Config or similar
export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization');
    // Simple auth check - in production, use proper authentication
    if (authHeader !== `Bearer ${process.env.API_SECRET || 'your-secret-key'}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const q = query(collection(db, 'allowedIPs'), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    const ips = [];
    querySnapshot.forEach((doc) => {
      ips.push(doc.data().ip);
    });
    
    return NextResponse.json({ 
      allowedIPs: ips,
      message: 'To use these IPs, set ALLOWED_IPS environment variable with comma-separated values'
    });
  } catch (error) {
    console.error('Error fetching allowed IPs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch allowed IPs' },
      { status: 500 }
    );
  }
}

