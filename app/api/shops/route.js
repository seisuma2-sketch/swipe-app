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
  let apiParams = { keyword: '' };

  if (rawKeyword) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      
      const prompt = `あなたは優秀な飲食店の検索コンシェルジュです。
      ユーザーの入力した自然な文章から、検索に最適な条件を抽出し、以下のJSONフォーマットで出力してください。
      余計なテキストやMarkdown( \`\`\`json など )は一切含めず、純粋なJSON文字列のみを返してください。

      ユーザーの入力: "${rawKeyword}"

      【出力JSONフォーマット】
      {
        "keyword": "料理名やお店の雰囲気など、検索に使う短いキーワード(例: 焼肉 ガッツリ 安い)",
        "parking": 0か1 (車や駐車場希望の文脈があれば1、なければ0),
        "private_room": 0か1 (個室希望があれば1、なければ0),
        "free_food": 0か1 (食べ放題希望があれば1、なければ0)
      }`;

      const result = await model.generateContent(prompt);
      // Geminiが出力したJSON文字列を綺麗にしてJavaScriptのデータに変換
      const responseText = result.response.text().trim().replace(/```json/g, '').replace(/```/g, '');
      apiParams = JSON.parse(responseText);
      
      console.log('🗣️ ユーザーの入力:', rawKeyword);
      console.log('🤖 Geminiの抽出結果:', apiParams);
    } catch (error) {
      console.error('Gemini解析エラー:', error);
      apiParams.keyword = rawKeyword; // 万が一AIが失敗したら入力をそのまま使う
    }
  }

  // ホットペッパーAPIのURL作り（10件取得）
  let url = `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?key=${hotpepperKey}&format=json&count=10`;

  if (lat && lng) {
    url += `&lat=${lat}&lng=${lng}&range=${range}`;
  } else {
    url += `&keyword=三宮`; 
  }

  // Geminiが弾き出した条件を合体！
  if (apiParams.keyword) url += `&keyword=${encodeURIComponent(apiParams.keyword)}`;
  if (apiParams.parking === 1) url += `&parking=1`;
  if (apiParams.private_room === 1) url += `&private_room=1`;
  if (apiParams.free_food === 1) url += `&free_food=1`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    return NextResponse.json(data.results.shop || []);
  } catch (error) {
    console.error('APIエラー:', error);
    return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500 });
  }
}