import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

// Supabaseのクライアントを裏側でも初期化
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function GET(request) {
  const hotpepperKey = process.env.HOTPEPPER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const googleKey = process.env.GOOGLE_PLACES_API_KEY; 
  
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const rawKeyword = searchParams.get('keyword'); 
  const favoriteShop = searchParams.get('favorite'); 
  const userId = searchParams.get('user_id'); // 🌟 新しいパラメータ

  const range = '5'; 
  let apiParams = { keyword: '' };

  // 🌟 新機能：ログインユーザーの過去のLIKE履歴を取得してAIに食わせる！
  let historyText = "特になし";
  if (userId) {
    const { data: historyData } = await supabase
      .from('swipes')
      .select('restaurant_name')
      .eq('user_id', userId)
      .eq('is_like', true)
      .limit(20);
    
    if (historyData && historyData.length > 0) {
      historyText = historyData.map(h => h.restaurant_name.replace('[G] ', '')).join(', ');
    }
  }

  if (rawKeyword || favoriteShop || userId) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      
      const prompt = `あなたは優秀な飲食店の検索コンシェルジュです。
      ユーザーの「今の気分」「好きな店の系統」に加えて、「過去にLIKEしたお店の履歴」を総合的に分析して、今最も刺さる検索条件を1単語で抽出してください。
      余計なテキストやMarkdown( \`\`\`json など )は一切含めず、純粋なJSON文字列のみを返してください。

      今の気分・条件: "${rawKeyword || '特になし'}"
      普段よく行くお店の系統: "${favoriteShop || '特になし'}"
      過去にこのユーザーがLIKEしたお店の履歴: "${historyText}"

      【絶対のルール】
      ・過去の履歴にラーメンが多ければラーメン系、居酒屋が多ければ居酒屋系など、好みの傾向をキーワードに色濃く反映させてください。
      ・検索ヒット件数を増やすため、出力するキーワードは「最も適切な1単語のみ」にしてください。

      【出力JSONフォーマット】
      {
        "keyword": "検索用キーワードを絶対に1単語で指定(例: 焼肉)",
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

  // 📦 1: ホットペッパーAPIから取得
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
    hpShops = (data.results?.shop || []).map(shop => ({ ...shop, dataSource: 'hotpepper' }));
  } catch (error) {
    console.error('ホットペッパーAPIエラー:', error);
  }

  // 📦 2: Google Places APIから取得
  let googleShops = [];
  
  if (!googleKey) {
    googleShops = [{ id: 'no-google-key', name: '[G] ⚠️Googleの鍵がないよ！', photo: { pc: { l: '' } }, genre: { name: '環境変数エラー' }, budget: { name: '', average: '' }, lat: lat || '34.69', lng: lng || '135.19', address: '設定を確認してね', access: '', open: '', urls: { pc: '' }, dataSource: 'error' }];
  } else if (lat && lng) {
    let googleUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},lng=${lng}&radius=3000&type=restaurant&key=${googleKey}&language=ja`;
    if (apiParams.keyword) googleUrl += `&keyword=${encodeURIComponent(apiParams.keyword)}`;
    
    try {
      const gRes = await fetch(googleUrl);
      const gData = await gRes.json();
      
      if (gData.status !== 'OK' && gData.status !== 'ZERO_RESULTS') {
        googleShops = [{ id: 'google-api-error', name: `[G] ⚠️エラー: ${gData.status}`, photo: { pc: { l: '' } }, genre: { name: 'APIエラー' }, budget: { name: '', average: '' }, lat: lat, lng: lng, address: gData.error_message || '', access: '', open: '', urls: { pc: '' }, dataSource: 'error' }];
      } else {
        const googleResults = gData.results || [];
        googleShops = googleResults.map((place) => {
          const photoUrl = place.photos ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=500&photoreference=${place.photos[0].photo_reference}&key=${googleKey}` : null;
          let budgetName = '現地でチェック！';
          if (place.price_level === 1) budgetName = '💰 コスパ最強（安め）';
          if (place.price_level === 2) budgetName = '💰 ちょうどいい（標準）';
          if (place.price_level === 3) budgetName = '💰 ごほうび飯（高め）';

          const ratingText = place.rating && place.user_ratings_total ? `⭐️ ${place.rating} (${place.user_ratings_total.toLocaleString()}件の口コミ)` : 'Googleマップの隠れた名店';

          return {
            id: place.place_id,
            name: `[G] ${place.name}`,
            photo: { pc: { l: photoUrl } },
            genre: { name: ratingText },
            budget: { name: budgetName, average: budgetName },
            lat: place.geometry.location.lat.toString(),
            lng: place.geometry.location.lng.toString(),
            address: place.vicinity || '住所情報なし',
            access: 'Googleマップで詳細ルートを確認してね！',
            open: '詳細は下のボタンからマップをチェック！',
            urls: { pc: `http://googleusercontent.com/maps.google.com/?q=${encodeURIComponent(place.name)}&query_place_id=${place.place_id}` },
            dataSource: 'google',
            reviewCount: place.user_ratings_total || 0
          };
        });
      }
    } catch (error) {
      console.error('Google Places API通信エラー:', error);
    }
  }

  // 📦 3: 合体＆シャッフル
  const combinedShops = [...hpShops, ...googleShops];
  for (let i = combinedShops.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combinedShops[i], combinedShops[j]] = [combinedShops[j], combinedShops[i]];
  }

  return NextResponse.json(combinedShops);
}