import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function GET(request) {
  const hotpepperKey = process.env.HOTPEPPER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const rawKeyword = searchParams.get('keyword'); 
  const favoriteShop = searchParams.get('favorite'); 
  
  // 🌟 改善ポイント1：検索範囲を「3(1km)」から「4(2km)」に広げてヒット率を爆上げ！
  // さらに広げたい場合は「5(3km)」にしてもOK！
  const range = '4'; 
  let apiParams = { keyword: '' };

  if (rawKeyword || favoriteShop) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      
      // 🌟 改善ポイント2：AIが欲張らないように「絶対に1単語」と強く指示を出す！
      const prompt = `あなたは優秀な飲食店の検索コンシェルジュです。
      ユーザーの「今の気分」と「普段よく行くお店の好み」を組み合わせて、検索に最適な条件を抽出し、以下のJSONフォーマットで出力してください。
      余計なテキストやMarkdown( \`\`\`json など )は一切含めず、純粋なJSON文字列のみを返してください。

      今の気分・条件: "${rawKeyword || '特になし'}"
      普段よく行くお店の系統: "${favoriteShop || '特になし'}"

      【絶対のルール】
      ・ホットペッパーで検索ヒット件数を増やすため、キーワードは欲張らずに「最も適切な1単語のみ」にしてください。
      ・ダメな例: "ファミレス イタリアン 安い" -> 良い例: "イタリアン"
      ・ダメな例: "ラーメン 豚骨 濃いめ" -> 良い例: "ラーメン"

      【出力JSONフォーマット】
      {
        "keyword": "検索用キーワードを絶対に1単語で指定(例: ラーメン)",
        "parking": 0か1 (車や駐車場希望の文脈があれば1、なければ0),
        "private_room": 0か1 (個室希望があれば1、なければ0),
        "free_food": 0か1 (食べ放題希望があれば1、なければ0)
      }`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text().trim().replace(/```json/g, '').replace(/```/g, '');
      apiParams = JSON.parse(responseText);
      
      console.log('🗣️ 気分:', rawKeyword, '/ 好み:', favoriteShop);
      console.log('🤖 Geminiの抽出結果:', apiParams);
    } catch (error) {
      console.error('Gemini解析エラー:', error);
      // AIが失敗した時は、とりあえず入力をそのまま使う
      apiParams.keyword = favoriteShop || rawKeyword; 
    }
  }

  let url = `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?key=${hotpepperKey}&format=json&count=10`;

  if (lat && lng) {
    url += `&lat=${lat}&lng=${lng}&range=${range}`;
  } else {
    url += `&keyword=三宮`; 
  }

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