import { NextResponse } from 'next/server';

// Admin password - in production, use environment variable
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

export async function POST(request) {
  try {
    const { password } = await request.json();
    
    if (password === ADMIN_PASSWORD) {
      return NextResponse.json({ authenticated: true });
    } else {
      return NextResponse.json(
        { authenticated: false, message: 'Incorrect password' },
        { status: 401 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { authenticated: false, message: 'Error authenticating' },
      { status: 500 }
    );
  }
}

