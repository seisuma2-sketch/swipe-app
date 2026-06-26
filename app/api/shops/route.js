import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function GET(request) {
  const hotpepperKey = process.env.HOTPEPPER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const googleKey = process.env.GOOGLE_PLACES_API_KEY; // 🌟 Googleの鍵を読み込む！
  
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const rawKeyword = searchParams.get('keyword'); 
  const favoriteShop = searchParams.get('favorite'); 
  
  const range = '4'; // 2km圏内
  let apiParams = { keyword: '' };

  if (rawKeyword || favoriteShop) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      
      const prompt = `あなたは優秀な飲食店の検索コンシェルジュです。
      ユーザーの「今の気分」と「普段よく行くお店の好み」を組み合わせて、検索に最適な条件を抽出し、以下のJSONフォーマットで出力してください。
      余計なテキストやMarkdown( \`\`\`json など )は一切含めず、純粋なJSON文字列のみを返してください。

      今の気分・条件: "${rawKeyword || '特になし'}"
      普段よく行くお店の系統: "${favoriteShop || '特になし'}"

      【絶対のルール】
      ・ホットペッパーやGoogle検索のヒット件数を増やすため、キーワードは欲張らずに「最も適切な1単語のみ」にしてください。
      ・ダメな例: "ファミレス イタリアン 安い" -> 良い例: "イタリアン"

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
    } catch (error) {
      console.error('Gemini解析エラー:', error);
      apiParams.keyword = favoriteShop || rawKeyword || ''; 
    }
  }

  // ----------------------------------------------------
  // 📦 ミッション1: ホットペッパーAPIからお店を取得
  // ----------------------------------------------------
  let hpShops = [];
  let hpUrl = `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?key=${hotpepperKey}&format=json&count=10`;

  if (lat && lng) {
    hpUrl += `&lat=${lat}&lng=${lng}&range=${range}`;
  } else {
    hpUrl += `&keyword=三宮`; 
  }

  if (apiParams.keyword) hpUrl += `&keyword=${encodeURIComponent(apiParams.keyword)}`;
  if (apiParams.parking === 1) hpUrl += `&parking=1`;
  if (apiParams.private_room === 1) hpUrl += `&private_room=1`;
  if (apiParams.free_food === 1) hpUrl += `&free_food=1`;

  try {
    const res = await fetch(hpUrl);
    const data = await res.json();
    hpShops = data.results?.shop || [];
  } catch (error) {
    console.error('ホットペッパーAPIエラー:', error);
  }

  // ----------------------------------------------------
  // 📦 ミッション2: Google Places APIからお店を取得
  // ----------------------------------------------------
  let googleShops = [];
  if (lat && lng && googleKey) {
    // 検索半径2000m(2km)でGoogleマップからレストランを検索
    let googleUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=2000&type=restaurant&key=${googleKey}&language=ja`;
    
    if (apiParams.keyword) {
      googleUrl += `&keyword=${encodeURIComponent(apiParams.keyword)}`;
    }
    
    try {
      const gRes = await fetch(googleUrl);
      const gData = await gRes.json();
      const googleResults = gData.results || [];
      
      // 🌟 Googleのデータ構造をホットペッパーの形に綺麗に翻訳（マッピング）するぜ！
      googleShops = googleResults.map((place) => {
        // 写真がある場合はGoogleの画像生成URLを組み立てる
        const photoUrl = place.photos 
          ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=500&photoreference=${place.photos[0].photo_reference}&key=${googleKey}`
          : null;
          
        // 価格帯レベル（1〜4）をお財布ガイドの文字に変換
        let budgetName = '現地でチェック！';
        if (place.price_level === 1) budgetName = '💰 コスパ最強（安め）';
        if (place.price_level === 2) budgetName = '💰 ちょうどいい（標準）';
        if (place.price_level === 3) budgetName = '💰 ごほうび飯（高め）';

        return {
          id: place.place_id,
          name: `[G] ${place.name}`, // Googleマップのデータとひと目で分かるように印を付与！
          photo: { pc: { l: photoUrl } },
          genre: { name: place.rating ? `⭐️ ${place.rating} (Googleマップ)` : 'Googleマップの隠れた名店' },
          budget: { name: budgetName, average: budgetName },
          lat: place.geometry.location.lat.toString(),
          lng: place.geometry.location.lng.toString(),
          address: place.vicinity || '住所情報なし',
          access: 'Googleマップで詳細ルートを確認してね！',
          open: '詳細は下のボタンからマップをチェック！',
          // 詳細ボタンを押したときに、直接Googleマップアプリのその店にジャンプする最強のリンク！
          urls: { pc: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${place.place_id}` }
        };
      });
    } catch (error) {
      console.error('Google Places APIエラー:', error);
    }
  }

  // ----------------------------------------------------
  // 📦 ミッション3: 2つのデータソースを合体させてシャッフル！
  // ----------------------------------------------------
  const combinedShops = [...hpShops, ...googleShops];
  
  // シャッフルして毎回新しい出会いを作る（Fisher-Yatesシャッフル）
  for (let i = combinedShops.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combinedShops[i], combinedShops[j]] = [combinedShops[j], combinedShops[i]];
  }

  // 合体＆厳選された最強のリストをフロントに返すぜ！
  return NextResponse.json(combinedShops);
}