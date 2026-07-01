import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

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
  const userId = searchParams.get('user_id');
  const userType = searchParams.get('user_type') || 'student';

  const range = '5';
  let apiParams = { keyword: '' };

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

      let prompt = '';
      if (userType === 'adult') {
        prompt = `あなたは『社会人・大人』向けの飲食店検索コンシェルジュです。
        ユーザーの「今の気分」「好きな店の系統」「過去にLIKEした履歴」を分析し、今最も刺さる検索条件を1単語で抽出してください。
        【絶対のルール】落ち着いた雰囲気、会社宴会、デート、接待、少し贅沢な食事などに使えるお店を意識してください。
        出力するキーワードは「最も適切な1単語のみ」にしてください。余計なテキストやMarkdownは一切含めず、純粋なJSON文字列のみを返してください。`;
      } else {
        prompt = `あなたは『お金はないけど美味い飯が食いたい大学生』向けの飲食店検索コンシェルジュです。
        ユーザーの「今の気分」「好きな店の系統」「過去にLIKEした履歴」を分析し、今最も刺さる検索条件を1単語で抽出してください。
        【絶対のルール】「コスパ最強」「大盛り」「安い」「B級グルメ」「学生向け居酒屋」などの要素を強めに意識し、高級すぎるジャンルは避けてください。
        また、ユーザーの気分によっては、スシロー、くら寿司、サイゼリヤなどの「チェーン店」や「回転寿司」「ファミレス」「ファストフード」といったキーワードも積極的に抽出してください。
        出力するキーワードは「最も適切な1単語のみ」にしてください。余計なテキストやMarkdownは一切含めず、純粋なJSON文字列のみを返してください。`;
      }

      // 🌟 追加：テレビ・話題という言葉があった時の特別ルールをAIに教え込む！
      // 🌟 距離の範囲（radius）もAIに判断させるようにJSONに追加！
      prompt += `\n\n今の気分・条件: "${rawKeyword || '特になし'}"\n普段よく行くお店の系統: "${favoriteShop || '特になし'}"\n過去のLIKE履歴: "${historyText}"\n
      【特別ルール】もし条件に「テレビ」や「話題」が含まれている場合は、メディアでよく紹介されるような「名物」「行列」「有名店」といったキーワードを優先して抽出してください。
      【出力JSONフォーマット】
      { 
        "keyword": "検索用1単語", 
        "parking": 0か1, 
        "private_room": 0か1, 
        "free_food": 0か1,
        "radius": "近場なら1000、普通なら3000、ドライブ等なら10000などの数値"
      }`;
      const result = await model.generateContent(prompt);
      const responseText = result.response.text().trim().replace(/```json/g, '').replace(/```/g, '');
      apiParams = JSON.parse(responseText);
    } catch (error) {
      console.error('Gemini解析エラー:', error);
      apiParams.keyword = favoriteShop || rawKeyword || '';
    }
  }

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
    hpShops = (data.results?.shop || []).map(shop => ({
      ...shop,
      dataSource: 'hotpepper',
      card: shop.card || '現地で確認'
    }));
  } catch (error) {
    console.error('ホットペッパーAPIエラー:', error);
  }

  let googleShops = [];
  if (!googleKey) {
    googleShops = [{ id: 'error', name: '[G] ⚠️エラー', dataSource: 'error' }];
  } else if (lat && lng) {
    // 🌟 AIが決めたradiusを使う（デフォルトは3000）
    const searchRadius = apiParams.radius || 3000;
    let googleUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${searchRadius}&type=restaurant&key=${googleKey}&language=ja`;
    if (apiParams.keyword) googleUrl += `&keyword=${encodeURIComponent(apiParams.keyword)}`;
    try {
      const gRes = await fetch(googleUrl);
      const gData = await gRes.json();

      if (gData.status === 'OK' || gData.status === 'ZERO_RESULTS') {
        const rawGoogleResults = gData.results || [];

        const filteredGoogleResults = rawGoogleResults.filter(place => {
          if (userType === 'student' && place.price_level >= 3) return false;
          return true;
        });

        googleShops = filteredGoogleResults.map((place) => {
          const photoUrl = place.photos ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=500&photoreference=${place.photos[0].photo_reference}&key=${googleKey}` : null;
          let budgetName = '現地でチェック！';
          if (place.price_level === 1) budgetName = '💰 コスパ最強（安め）';
          if (place.price_level === 2) budgetName = '💰 ちょうどいい（標準）';
          if (place.price_level === 3) budgetName = '💰 ちょっと贅沢（高め）';
          if (place.price_level === 4) budgetName = '💰 ガチ高級店（超高め）';

          return {
            id: place.place_id,
            name: `[G] ${place.name}`,
            photo: { pc: { l: photoUrl } },
            genre: { name: place.rating ? `⭐️ ${place.rating} (${place.user_ratings_total}件)` : '名店' },
            budget: { name: budgetName, average: budgetName },
            lat: place.geometry.location.lat.toString(),
            lng: place.geometry.location.lng.toString(),
            address: place.vicinity || '',
            access: 'Googleマップで詳細を確認！',
            open: '詳細はマップをチェック！',
            urls: { pc: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name.replace('[G] ', ''))}&query_place_id=${place.place_id}` }, card: '現地で確認'
          };
        });
      }
    } catch (error) {
      console.error('Google APIエラー:', error);
    }
  }

  const combinedShops = [...hpShops, ...googleShops];
  for (let i = combinedShops.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combinedShops[i], combinedShops[j]] = [combinedShops[j], combinedShops[i]];
  }

  return NextResponse.json(combinedShops);
}