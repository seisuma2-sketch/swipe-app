import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai'; 

export async function GET(request) {
  const hotpepperKey = process.env.HOTPEPPER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const rawKeyword = searchParams.get('keyword'); 
  
  const range = '3'; 
  let finalKeyword = '';

  if (rawKeyword) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      
      const prompt = `あなたは飲食店の検索キーワード抽出AIです。以下のテキストから、飲食店を検索するためのキーワード（料理名やジャンル）を1つだけ抽出してください。
      
      【絶対のルール】
      ・抽出したキーワード（単語）のみをそのまま出力すること。
      ・「THINK」などの思考プロセス、解説、挨拶などの余計な文字は「絶対に」含めないこと。
      
      テキスト: ${rawKeyword}`;

      const result = await model.generateContent(prompt);
      finalKeyword = result.response.text().trim();
      
      console.log('🗣️ ユーザーの入力:', rawKeyword);
      console.log('🤖 Geminiの抽出結果:', finalKeyword);
    } catch (error) {
      console.error('Geminiエラー:', error);
      finalKeyword = rawKeyword; 
    }
  }

  // 🌟 ここを count=10 に変更！星翔のGeminiコードと合体させたぜ！
  let url = `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?key=${hotpepperKey}&format=json&count=10`;

  if (lat && lng) {
    url += `&lat=${lat}&lng=${lng}&range=${range}`;
  } else {
    url += `&keyword=三宮`; 
  }

  if (finalKeyword) {
    url += `&keyword=${encodeURIComponent(finalKeyword)}`;
  }

  try {
    const res = await fetch(url);
    const data = await res.json();
    return NextResponse.json(data.results.shop || []);
  } catch (error) {
    console.error('APIエラー:', error);
    return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500 });
  }
}