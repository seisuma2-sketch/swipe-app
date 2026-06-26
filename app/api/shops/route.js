import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function GET(request) {
  const hotpepperKey = process.env.HOTPEPPER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const googleKey = process.env.GOOGLE_PLACES_API_KEY; 
  
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const rawKeyword = searchParams.get('keyword'); 
  const favoriteShop = searchParams.get('favorite'); 
  
  const range = '4'; 
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
    hpShops = data.results?.shop || [];
  } catch (error) {
    console.error('ホットペッパーAPIエラー:', error);
  }

  // 📦 2: Google Places APIから取得
  let googleShops = [];
  
  // 🌟 もしVercelに鍵が設定されていなかったら、エラーカードを作る！
  if (!googleKey) {
    googleShops = [{
      id: 'no-google-key',
      name: '[G] ⚠️Googleの鍵がないよ！',
      photo: { pc: { l: '' } },
      genre: { name: '環境変数エラー' },
      budget: { name: 'VercelのSettingsを確認！', average: '鍵が読み込めてません' },
      lat: lat || '34.69', lng: lng || '135.19',
      address: 'VercelのEnvironment Variablesに GOOGLE_PLACES_API_KEY が設定されているか確認して！',
      access: '設定後、新しくデプロイし直すと直るよ！',
      open: '',
      urls: { pc: '' }
    }];
  } else if (lat && lng) {
    let googleUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=2000&type=restaurant&key=${googleKey}&language=ja`;
    if (apiParams.keyword) googleUrl += `&keyword=${encodeURIComponent(apiParams.keyword)}`;
    
    try {
      const gRes = await fetch(googleUrl);
      const gData = await gRes.json();
      
      // 🌟 もしGoogleがエラー（拒否など）を返してきたら、カードにして画面に表示！
      if (gData.status !== 'OK' && gData.status !== 'ZERO_RESULTS') {
        googleShops = [{
          id: 'google-api-error',
          name: `[G] ⚠️エラー: ${gData.status}`,
          photo: { pc: { l: '' } },
          genre: { name: 'Google API拒否エラー' },
          budget: { name: 'API設定を確認！', average: '制限がキツすぎるかも' },
          lat: lat, lng: lng,
          address: gData.error_message || 'Google Cloudの設定を確認してね',
          access: '「アプリケーションの制限」が「なし」になっているかチェック！',
          open: '',
          urls: { pc: '' }
        }];
      } else {
        const googleResults = gData.results || [];
        googleShops = googleResults.map((place) => {
          const photoUrl = place.photos 
            ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=500&photoreference=${place.photos[0].photo_reference}&key=${googleKey}`
            : null;
            
          let budgetName = '現地でチェック！';
          if (place.price_level === 1) budgetName = '💰 コスパ最強（安め）';
          if (place.price_level === 2) budgetName = '💰 ちょうどいい（標準）';
          if (place.price_level === 3) budgetName = '💰 ごほうび飯（高め）';

          return {
            id: place.place_id,
            name: `[G] ${place.name}`,
            photo: { pc: { l: photoUrl } },
            genre: { name: place.rating ? `⭐️ ${place.rating} (Googleマップ)` : 'Googleマップの隠れた名店' },
            budget: { name: budgetName, average: budgetName },
            lat: place.geometry.location.lat.toString(),
            lng: place.geometry.location.lng.toString(),
            address: place.vicinity || '住所情報なし',
            access: 'Googleマップで詳細ルートを確認してね！',
            open: '詳細は下のボタンからマップをチェック！',
            urls: { pc: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${place.place_id}` }
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