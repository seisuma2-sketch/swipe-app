'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

function calculateDistance(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c); 
}

export default function SwipeApp() {
  const [myUserId, setMyUserId] = useState('');
  const [roomId, setRoomId] = useState(null);
  const [cards, setCards] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [favoriteShop, setFavoriteShop] = useState(''); 
  const [myLocation, setMyLocation] = useState({ lat: null, lng: null });
  const [startX, setStartX] = useState(0);
  const [currentX, setCurrentX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [swipeLogs, setSwipeLogs] = useState([]);
  
  const [matchData, setMatchData] = useState(null);
  const [matchedShops, setMatchedShops] = useState([]); 
  const [isRouletteModalOpen, setIsRouletteModalOpen] = useState(false); 
  const [isSpinning, setIsSpinning] = useState(false); 
  const [rouletteRotation, setRouletteRotation] = useState(0); 
  const [rouletteWinner, setRouletteWinner] = useState(null); 

  const [flyingItems, setFlyingItems] = useState([]);
  const channelRef = useRef(null);
  const tapCountRef = useRef(0);
  const hasVibratedRef = useRef(false);

  const [selectedShop, setSelectedShop] = useState(null);
  
  const [trendingShops, setTrendingShops] = useState([]);

  const applyPreset = (fav, keyword) => {
    setFavoriteShop(fav);
    setSearchKeyword(keyword);
  };

  const fetchShops = async (overrideKeyword) => {
    setIsLoading(true);
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const lat = searchParams.get('lat') || myLocation.lat || '';
      const lng = searchParams.get('lng') || myLocation.lng || '';
      const keyword = overrideKeyword !== undefined ? overrideKeyword : (searchParams.get('keyword') || searchKeyword || '');
      const favorite = searchParams.get('favorite') || favoriteShop || '';
      
      const res = await fetch(`/api/shops?lat=${lat}&lng=${lng}&keyword=${encodeURIComponent(keyword)}&favorite=${encodeURIComponent(favorite)}`);
      const data = await res.json();
      if (Array.isArray(data)) setCards(data);
    } catch (error) {
      console.error('通信エラー:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOkawari = (mood) => {
    setSearchKeyword(mood);
    fetchShops(mood);
  };

  // 🌟 改良ポイント：データが空っぽの時は、リアルな初期データを表示する！
  useEffect(() => {
    if (roomId) return; 
    const fetchTrending = async () => {
      const { data, error } = await supabase
        .from('swipes')
        .select('restaurant_name')
        .eq('is_like', true)
        .order('created_at', { ascending: false })
        .limit(200);

      if (data && data.length > 0 && !error) {
        const counts = {};
        data.forEach(item => {
          const name = item.restaurant_name.replace(/\[G\] /g, ''); 
          counts[name] = (counts[name] || 0) + 1;
        });
        
        const sorted = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, count]) => ({ name, count }));
        
        setTrendingShops(sorted);
      } else {
        // DBが空の時のための、リアルなダミーランキング
        setTrendingShops([
          { name: 'サイゼリヤ 三宮センター街店', count: 42 },
          { name: 'ずんどう屋 神戸三宮店', count: 35 },
          { name: '鳥貴族 三宮阪急前店', count: 28 },
          { name: '焼肉きんぐ 生田川店', count: 21 },
          { name: '一蘭 三宮店', count: 18 }
        ]);
      }
    };
    fetchTrending();
  }, [roomId]);

  useEffect(() => {
    setMyUserId('user_' + Math.floor(Math.random() * 10000));
    const searchParams = new URLSearchParams(window.location.search);
    const roomFromUrl = searchParams.get('room');
    const latFromUrl = searchParams.get('lat');
    const lngFromUrl = searchParams.get('lng');
    const keywordFromUrl = searchParams.get('keyword');
    const favoriteFromUrl = searchParams.get('favorite');

    if (roomFromUrl) setRoomId(roomFromUrl);
    if (latFromUrl && lngFromUrl) {
      setMyLocation({ lat: parseFloat(latFromUrl), lng: parseFloat(lngFromUrl) });
    }
    if (keywordFromUrl) setSearchKeyword(keywordFromUrl);
    if (favoriteFromUrl) setFavoriteShop(favoriteFromUrl);
  }, []);

  useEffect(() => {
    if (!roomId) return;

    fetchShops(); 

    const fetchExistingMatches = async () => {
      const { data } = await supabase.from('swipes').select('restaurant_name, is_like').eq('room_id', roomId);
      if (data) {
        const counts = {};
        data.forEach(x => { if (x.is_like) counts[x.restaurant_name] = (counts[x.restaurant_name] || 0) + 1; });
        const matches = Object.keys(counts).filter(name => counts[name] >= 2);
        setMatchedShops(matches);
      }
    };
    fetchExistingMatches();

    const channel = supabase.channel(`room-${roomId}`, {
      config: { broadcast: { self: false } }
    });
    channelRef.current = channel;

    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'swipes', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const newSwipe = payload.new;
          setSwipeLogs((prev) => [newSwipe, ...prev]);

          if (newSwipe.is_like) {
            setTimeout(async () => {
              const { data } = await supabase.from('swipes').select('user_id').eq('room_id', roomId).eq('restaurant_name', newSwipe.restaurant_name).eq('is_like', true);
              if (data && data.length >= 2) {
                setMatchedShops((prev) => Array.from(new Set([...prev, newSwipe.restaurant_name])));
                if (newSwipe.user_id !== myUserId) {
                  setMatchData(newSwipe);
                  setTimeout(() => setMatchData(null), 4000);
                }
              }
            }, 500);
          }
        }
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'roulettes', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const rouletteData = payload.new;
          startRouletteAnimation(rouletteData.winner_restaurant_name);
        }
      )
      .on('broadcast', { event: 'fly_item' }, (payload) => {
        triggerFly(payload.payload.content, payload.payload.type, payload.payload.x);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, myUserId]); 

  const triggerFly = (content, type, x) => {
    const id = Date.now() + Math.random();
    setFlyingItems((prev) => [...prev, { id, content, type, x }]);
    setTimeout(() => { setFlyingItems((prev) => prev.filter((item) => item.id !== id)); }, 1500);
  };

  const handleRouletteTap = (e) => {
    if (!isSpinning) return; 
    tapCountRef.current += 1;
    const tapX = e.clientX || (e.touches && e.touches[0].clientX) || window.innerWidth / 2;

    if (tapCountRef.current % 10 === 0) {
      const secretImages = ['/デブ.png', '/スクリーンショット_2026-06-23_131841-removebg-preview.png', '/スクリーンショット_2026-06-23_131828-removebg-preview.png'];
      const randomImage = secretImages[Math.floor(Math.random() * secretImages.length)];
      triggerFly(randomImage, 'image', tapX);
      channelRef.current?.send({ type: 'broadcast', event: 'fly_item', payload: { content: randomImage, type: 'image', x: tapX } });
    } else {
      const emojis = ['🍣', '🥩', '🍜', '🍻', '🥟', '🎉', '🔥'];
      const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
      triggerFly(randomEmoji, 'emoji', tapX);
      channelRef.current?.send({ type: 'broadcast', event: 'fly_item', payload: { content: randomEmoji, type: 'emoji', x: tapX } });
    }
  };

  const triggerRoulette = async () => {
    if (matchedShops.length === 0 || isSpinning) return;
    tapCountRef.current = 0;
    const randomIndex = Math.floor(Math.random() * matchedShops.length);
    const winnerName = matchedShops[randomIndex];
    await supabase.from('roulettes').insert([{ room_id: roomId, winner_restaurant_name: winnerName }]);
  };

  const startRouletteAnimation = (realWinner) => {
    setIsRouletteModalOpen(true);
    setIsSpinning(true);
    setRouletteWinner(null);

    const index = matchedShops.indexOf(realWinner);
    const segmentAngle = 360 / matchedShops.length;
    const targetAngle = 360 - (index * segmentAngle) - (segmentAngle / 2);
    setRouletteRotation(1800 + targetAngle);

    setTimeout(() => {
      setIsSpinning(false);
      setRouletteWinner(realWinner);
    }, 4000);
  };

  const createNewRoom = () => {
    setIsLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const newRoomId = Math.random().toString(36).substring(2, 8);
          window.location.href = `/?room=${newRoomId}&lat=${lat}&lng=${lng}&keyword=${encodeURIComponent(searchKeyword)}&favorite=${encodeURIComponent(favoriteShop)}`;
        },
        () => {
          const newRoomId = Math.random().toString(36).substring(2, 8);
          window.location.href = `/?room=${newRoomId}&keyword=${encodeURIComponent(searchKeyword)}&favorite=${encodeURIComponent(favoriteShop)}`;
        }
      );
    } else {
      const newRoomId = Math.random().toString(36).substring(2, 8);
      window.location.href = `/?room=${newRoomId}&keyword=${encodeURIComponent(searchKeyword)}&favorite=${encodeURIComponent(favoriteShop)}`;
    }
  };

  const copyRoomUrl = () => {
    navigator.clipboard.writeText(window.location.href);
    alert('URLをコピーしたよ！友達に送ろう！');
  };

  const handlePointerDown = (e) => { 
    setStartX(e.clientX); 
    setIsDragging(true); 
    hasVibratedRef.current = false;
  };
  
  const handlePointerMove = (e) => { 
    if (!isDragging) return; 
    const moveX = e.clientX - startX;
    setCurrentX(moveX); 

    if (Math.abs(moveX) > 150 && !hasVibratedRef.current) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(40);
      hasVibratedRef.current = true;
    } else if (Math.abs(moveX) <= 150) {
      hasVibratedRef.current = false; 
    }
  };
  
  const handlePointerUp = async () => {
    if (!isDragging) return;
    setIsDragging(false);
    hasVibratedRef.current = false;

    if (Math.abs(currentX) > 150) {
      const isLike = currentX > 0;
      const swipedCard = cards[0];
      setCards((prev) => prev.slice(1));
      await supabase.from('swipes').insert([{ room_id: roomId, user_id: myUserId, restaurant_name: swipedCard.name, is_like: isLike }]);
    } else if (Math.abs(currentX) < 5) {
      setSelectedShop(cards[0]); 
    }
    setCurrentX(0);
  };

  if (!roomId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-gray-50 to-gray-200 p-4 pb-20">
        <div className="text-6xl mb-4 drop-shadow-md">📍</div>
        <h1 className="text-3xl font-extrabold mb-6 text-gray-800 tracking-tight text-center leading-tight">AIにおまかせ！<br/>今日のごはん何にする？</h1>
        
        {trendingShops.length > 0 && (
          <div className="mb-8 w-full max-w-sm">
            <h2 className="text-sm font-black text-orange-500 mb-3 flex items-center gap-2">
              <span className="animate-pulse">🔥</span> みんなのガチ狙い人気店
            </h2>
            <div className="flex overflow-x-auto gap-3 pb-4 snap-x hide-scrollbar">
              {trendingShops.map((shop, i) => (
                <div 
                  key={i} 
                  onClick={() => setFavoriteShop(shop.name)}
                  className="min-w-[140px] bg-white p-3 rounded-2xl shadow-sm border border-gray-200 cursor-pointer snap-start hover:border-orange-300 active:scale-95 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="text-[10px] font-black text-gray-400 mb-1">{i + 1}位</div>
                    <div className="text-sm font-extrabold text-gray-800 line-clamp-2 leading-snug">{shop.name}</div>
                  </div>
                  <div className="mt-2 flex items-center gap-1 text-xs font-bold text-pink-500 bg-pink-50 px-2 py-1 rounded-lg w-fit">
                    ❤️ {shop.count} LIKE
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 font-bold mt-1 text-right">※タップで入力欄にセット！</p>
            <style jsx>{`.hide-scrollbar::-webkit-scrollbar { display: none; } .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
          </div>
        )}

        <div className="mb-6 w-full max-w-sm bg-white p-4 rounded-2xl shadow-sm border border-gray-200">
          <label className="block text-xs font-black text-gray-400 uppercase tracking-wider mb-2">💡 えらぶだけで自動入力！</label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => applyPreset('サイゼリヤ', '金欠だけど男3人でお腹いっぱいガッツリ食べたい！')} className="bg-pink-50 hover:bg-pink-100 text-pink-700 text-xs font-bold py-2 px-3 rounded-xl border border-pink-200 active:scale-95 transition-all">💸 金欠ガッツリ</button>
            <button type="button" onClick={() => applyPreset('一蘭', '車で行くから、近くで駐車場がある美味いラーメン屋！')} className="bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold py-2 px-3 rounded-xl border border-blue-200 active:scale-95 transition-all">🍜 ドライブ麺</button>
            <button type="button" onClick={() => applyPreset('ずんどう屋', '夜遅く、深夜でも開いててガツンと食べられる店')} className="bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold py-2 px-3 rounded-xl border border-amber-200 active:scale-95 transition-all">🕒 深夜の夜食</button>
            <button type="button" onClick={() => applyPreset('', 'サークルの打ち上げ！大人数でワイワイできる個室のある居酒屋')} className="bg-green-50 hover:bg-green-100 text-green-700 text-xs font-bold py-2 px-3 rounded-xl border border-green-200 active:scale-95 transition-all">🍻 サークル飲み</button>
          </div>
        </div>

        <div className="mb-4 w-full max-w-sm">
          <label className="block text-sm font-bold text-gray-600 mb-1">❤️ 普段よく行く・好きなお店（任意）</label>
          <input type="text" value={favoriteShop} onChange={(e) => setFavoriteShop(e.target.value)} placeholder="例: サイゼリヤ、一蘭、丸源" className="w-full px-5 py-3 border border-pink-300 rounded-xl shadow-sm focus:ring-4 focus:ring-pink-500/30 focus:outline-none text-gray-900 font-medium bg-pink-50" />
        </div>

        <div className="mb-8 w-full max-w-sm">
          <label className="block text-sm font-bold text-gray-600 mb-1">📝 今日のわがまま条件</label>
          <textarea value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} placeholder="例: 金欠だけど男3人でガッツリ食べたい！" className="w-full px-5 py-3 border border-blue-300 rounded-xl shadow-sm focus:ring-4 focus:ring-blue-500/30 focus:outline-none text-gray-900 font-medium resize-none h-20 bg-blue-50" />
        </div>

        {isLoading ? ( 
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <p className="text-gray-500 font-bold">AIがお店を厳選中...</p>
          </div>
        ) : (
          <button onClick={createNewRoom} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-full shadow-xl text-lg flex items-center gap-2 active:scale-95 transition-transform w-full max-w-sm justify-center">
            <span>✨</span> AIに探してもらう
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 overflow-hidden relative pb-10">
      <style>{`
        @keyframes floatUp { 0% { transform: translateY(0) scale(1) rotate(0deg); opacity: 1; } 100% { transform: translateY(-400px) scale(1.5) rotate(15deg); opacity: 0; } }
        .animate-float-up { animation: floatUp 1.5s ease-out forwards; }
        @keyframes slideUp { 0% { transform: translateY(100%); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
        .animate-slide-up { animation: slideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
      `}</style>
      <h1 className="text-2xl font-extrabold mb-2 text-gray-800 mt-4">今日のごはん何にする？</h1>
      <div className="flex gap-3 mb-4 z-20 relative">
        <button onClick={() => window.location.href = '/'} className="bg-white text-gray-700 font-bold text-sm py-2 px-5 rounded-full shadow-sm border border-gray-200 active:scale-95 transition-transform">🏠 最初から</button>
        <button onClick={copyRoomUrl} className="bg-white text-gray-700 font-bold text-sm py-2 px-5 rounded-full shadow-sm border border-gray-200 active:scale-95 transition-transform">🔗 友達を招待</button>
      </div>

      <div className="relative w-80 h-96 mb-6">
        {isLoading ? ( 
          <div className="flex flex-col items-center justify-center w-full h-full bg-white/50 backdrop-blur-sm rounded-3xl border border-white">
            <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-500 mb-4"></div>
            <p className="text-gray-500 font-bold">お店を探しています...</p>
          </div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center w-full h-full bg-white rounded-3xl shadow-lg border border-gray-100 p-6 text-center animate-fade-in">
            <div className="text-4xl mb-2">🍽️</div>
            <p className="text-gray-900 font-black text-base mb-1">お店がなくなっちゃった！</p>
            <p className="text-gray-400 text-[11px] font-bold mb-4">今の気分を選んで「おかわり」しようぜ！</p>
            <div className="flex flex-col gap-2 w-full">
              <button onClick={() => handleOkawari('あっさり')} className="w-full bg-green-50 hover:bg-green-100 text-green-700 font-black py-2 px-4 rounded-xl border border-green-200 text-xs active:scale-95 transition-all">🥗 あっさり・ヘルシー系</button>
              <button onClick={() => handleOkawari('こってり')} className="w-full bg-orange-50 hover:bg-orange-100 text-orange-700 font-black py-2 px-4 rounded-xl border border-orange-200 text-xs active:scale-95 transition-all">🍜 こってり・濃いめ系</button>
              <button onClick={() => handleOkawari('肉')} className="w-full bg-red-50 hover:bg-red-100 text-red-700 font-black py-2 px-4 rounded-xl border border-red-200 text-xs active:scale-95 transition-all">🥩 ガッツリお肉系</button>
              <button onClick={() => handleOkawari('')} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-black py-2 px-4 rounded-xl text-xs active:scale-95 transition-all">🔄 条件なしで全リロード</button>
            </div>
          </div>
        ) : (
          [...cards].reverse().map((card, index) => {
            const isTopCard = index === cards.length - 1;
            const distance = calculateDistance(myLocation.lat, myLocation.lng, parseFloat(card.lat), parseFloat(card.lng));
            
            const cardStyle = isTopCard
              ? { transform: `translateX(${currentX}px) rotate(${currentX * 0.08}deg)`, transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)', zIndex: 10, boxShadow: isDragging ? `0px ${Math.abs(currentX) / 10 + 20}px ${Math.abs(currentX) / 5 + 30}px rgba(0,0,0,${Math.min(Math.abs(currentX) / 500 + 0.1, 0.3)})` : '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }
              : { transform: 'scale(0.95) translateY(10px)', transition: 'transform 0.3s ease-out', zIndex: 0 };

            return (
              <div key={card.id} onPointerDown={isTopCard ? handlePointerDown : null} onPointerMove={isTopCard ? handlePointerMove : null} onPointerUp={isTopCard ? handlePointerUp : null} onPointerLeave={isTopCard ? handlePointerUp : null} style={cardStyle} className="absolute top-0 left-0 w-full h-full bg-white rounded-3xl overflow-hidden select-none touch-none cursor-pointer">
                <div className="absolute top-3 left-3 z-20 flex flex-col gap-1 pointer-events-none">
                  {card.dataSource === 'google' && card.reviewCount >= 100 && ( <span className="bg-red-500/90 backdrop-blur-sm text-white text-[10px] font-black px-2 py-1 rounded-full shadow-md">🔥 口コミ多数の有名店</span> )}
                  {card.dataSource === 'hotpepper' && ( <span className="bg-orange-500/90 backdrop-blur-sm text-white text-[10px] font-black px-2 py-1 rounded-full shadow-md">📝 HotPepper掲載店</span> )}
                </div>
                {isTopCard && Math.abs(currentX) < 10 && ( <div className="absolute top-3 right-3 bg-black/60 text-white text-xs font-bold px-3 py-1 rounded-full z-30 backdrop-blur-sm pointer-events-none">ℹ️ タップで詳細</div> )}
                {card.photo?.pc?.l ? ( <img src={card.photo.pc.l} className="w-full h-[55%] object-cover pointer-events-none" draggable="false" /> ) : ( <div className="w-full h-[55%] bg-gray-100 flex items-center justify-center"><span className="text-4xl">🍽️</span></div> )}
                <div className="flex flex-col h-[45%] p-5 relative bg-white">
                  <h2 className="text-xl font-extrabold text-gray-900 leading-tight line-clamp-2">{card.name}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <p className="text-gray-500 text-sm font-medium">{card.genre?.name}</p>
                    {card.budget?.name && ( <span className="bg-amber-50 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-md border border-amber-200 shadow-sm">💰 {card.budget.name}</span> )}
                  </div>
                  {distance !== null && ( <div className="absolute bottom-5 left-5 bg-blue-50 text-blue-600 font-bold px-3 py-1.5 rounded-lg text-sm border border-blue-100">📍 {distance >= 1000 ? `${(distance / 1000).toFixed(1)}km` : `${distance}m`}</div> )}
                </div>
                {isTopCard && Math.abs(currentX) > 50 && ( <div className={`absolute top-6 px-6 py-2 border-4 font-extrabold rounded-xl text-3xl z-20 ${currentX > 0 ? 'border-green-500 text-green-500 left-6 -rotate-12 bg-white/90 backdrop-blur-sm' : 'border-red-500 text-red-500 right-6 rotate-12 bg-white/90 backdrop-blur-sm'}`} style={{ opacity: Math.min(Math.abs(currentX) / 100, 1) }}>{currentX > 0 ? 'LIKE' : 'NOPE'}</div> )}
              </div>
            );
          })
        )}
      </div>

      {matchedShops.length > 0 && (
        <div className="w-80 bg-gradient-to-r from-pink-50 to-orange-50 rounded-2xl border border-pink-100 p-4 mb-4 shadow-sm text-center">
          <h4 className="text-xs font-black text-pink-500 uppercase tracking-wider mb-2">🔥 マッチしたお店 ({matchedShops.length})</h4>
          <p className="text-xs text-gray-600 mb-3 truncate font-medium">{matchedShops.join(' / ')}</p>
          {matchedShops.length >= 2 ? ( <button onClick={triggerRoulette} className="w-full bg-gradient-to-r from-pink-500 to-orange-400 text-white font-black py-2.5 px-4 rounded-xl shadow-md transform hover:scale-102 active:scale-98 transition-all text-sm animate-pulse">🎯 運命のルーレットを回す！</button> ) : ( <p className="text-xs text-gray-400 font-bold">2つ以上で回せるよ！</p> )}
        </div>
      )}

      <div className="w-80 h-32 bg-white/80 backdrop-blur-md rounded-2xl shadow-lg border border-white/50 p-4 overflow-y-auto">
        <h3 className="text-xs font-black text-gray-400 mb-3 uppercase tracking-wider flex justify-between items-center">
          <span>みんなのアクション</span>
          <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span></span>
        </h3>
        {swipeLogs.length === 0 ? ( <p className="text-sm text-gray-400 text-center mt-4 font-medium">まだアクションがありません</p> ) : (
          <ul className="space-y-2">
            {swipeLogs.map((log, i) => (
              <li key={i} className="flex items-center p-2 rounded-xl bg-gray-50 border border-gray-100 transition-all">
                <span className={`px-2 py-1 rounded text-xs font-extrabold w-12 text-center mr-3 ${log.is_like ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>{log.is_like ? 'LIKE' : 'NOPE'}</span>
                <span className="font-bold text-gray-800 text-sm truncate flex-1">{log.restaurant_name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {matchData && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in">
          <div className="bg-white rounded-[2rem] p-8 m-4 shadow-2xl flex flex-col items-center text-center transform scale-100 animate-bounce-short border-4 border-pink-400 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-pink-500 to-orange-400"></div>
            <div className="text-6xl mb-2">🎉</div>
            <h2 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-orange-400 tracking-tight mb-2">MATCH!</h2>
            <p className="text-gray-500 font-bold mb-4 text-sm">誰かがこのお店をLIKEしました</p>
            <p className="text-2xl font-bold text-gray-900 bg-gray-50 px-4 py-3 rounded-xl border border-gray-200 w-full">{matchData.restaurant_name}</p>
            <button onClick={() => setMatchData(null)} className="mt-6 bg-gray-900 text-white font-bold py-3 px-8 rounded-full hover:bg-gray-800 transition-colors w-full">閉じる</button>
          </div>
        </div>
      )}

      {selectedShop && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex flex-col justify-end p-4 transition-opacity" onPointerDown={() => setSelectedShop(null)}>
          <div className="bg-white w-full max-w-sm mx-auto rounded-[2rem] shadow-2xl animate-slide-up relative max-h-[85vh] overflow-y-auto" onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={() => setSelectedShop(null)} className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold z-10 backdrop-blur-md transition-colors">✕</button>
            {selectedShop.photo?.pc?.l && ( <img src={selectedShop.photo.pc.l} alt={selectedShop.name} className="w-full h-48 object-cover" /> )}
            <div className="p-6">
              <p className="text-blue-500 text-xs font-bold mb-1">{selectedShop.genre?.name}</p>
              <h3 className="text-2xl font-black text-gray-900 leading-tight mb-4">{selectedShop.name}</h3>
              <div className="mb-4 bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200 p-4 rounded-2xl shadow-inner text-center">
                <p className="text-xs font-black text-amber-700 uppercase tracking-widest mb-1">💰 おさいふ安心ガイド 💰</p>
                <h4 className="text-xl font-black text-gray-950 leading-snug">「{selectedShop.budget?.average || selectedShop.budget?.name || '2,000円〜3,000円'}」あれば足りそう！</h4>
                <p className="text-[10px] text-amber-600 font-bold mt-1">※平均予算データより算出</p>
              </div>
              <div className="space-y-2 mb-6 bg-gray-50 p-4 rounded-xl border border-gray-100 text-xs">
                <p className="text-gray-700 flex items-start gap-2"><span className="text-sm">🚃</span><span className="flex-1 leading-snug"><strong>アクセス:</strong> {selectedShop.access || '情報なし'}</span></p>
                <p className="text-gray-700 flex items-start gap-2"><span className="text-sm">📍</span><span className="flex-1 leading-snug"><strong>住所:</strong> {selectedShop.address || '情報なし'}</span></p>
                <p className="text-gray-700 flex items-start gap-2"><span className="text-sm">🕒</span><span className="flex-1 leading-snug"><strong>営業時間:</strong> {selectedShop.open || '情報なし'}</span></p>
              </div>
              {selectedShop.urls?.pc && (
                selectedShop.dataSource === 'google' ? (
                  <a href={selectedShop.urls.pc} target="_blank" rel="noopener noreferrer" className="block w-full bg-blue-600 hover:bg-blue-700 text-white text-center font-bold py-3.5 rounded-full shadow-lg transition-transform active:scale-95 text-sm">📍 マップで今の混み具合をチェック！ ↗</a>
                ) : (
                  <a href={selectedShop.urls.pc} target="_blank" rel="noopener noreferrer" className="block w-full bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white text-center font-bold py-3.5 rounded-full shadow-lg transition-transform active:scale-95 text-sm">📱 待たずにすぐネット予約・クーポン！ ↗</a>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {isRouletteModalOpen && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 cursor-pointer select-none bg-black/80 backdrop-blur-md" onPointerDown={handleRouletteTap}>
          {isSpinning && <p className="absolute top-10 text-white font-bold animate-pulse">画面を連打しろ！！！</p>}
          <div className="bg-white rounded-[2.5rem] p-8 w-full max-w-sm shadow-2xl flex flex-col items-center text-center relative pointer-events-none">
            <h3 className="text-2xl font-black text-gray-800 mb-6">🎰 ど・れ・に・す・る？</h3>
            <div className="relative w-64 h-64 mb-8 flex items-center justify-center">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[15px] border-l-transparent border-r-[15px] border-r-transparent border-t-[25px] border-t-red-500 z-30 drop-shadow-md"></div>
              <div style={{ transform: `rotate(${rouletteRotation}deg)`, transition: isSpinning ? 'transform 4s cubic-bezier(0.1, 0.8, 0.1, 1)' : 'none' }} className="w-full h-full rounded-full border-8 border-gray-900 bg-gradient-to-tr from-yellow-300 via-pink-400 to-indigo-400 relative overflow-hidden flex items-center justify-center shadow-2xl">
                <div className="w-8 h-8 rounded-full bg-white border-4 border-gray-900 z-20 shadow-md"></div>
                <p className="text-white font-black text-xl z-10 rotate-45">❓</p>
                <p className="text-white font-black text-xl z-10 -rotate-45">✨</p>
              </div>
            </div>
            {rouletteWinner && (
              <div className="w-full bg-gradient-to-b from-yellow-50 to-amber-100 p-5 rounded-2xl border-2 border-yellow-400 shadow-inner animate-bounce-short pointer-events-auto">
                <p className="text-xs font-black text-amber-600 uppercase tracking-widest mb-1">👑 今日のごはんはココ！</p>
                <h4 className="text-2xl font-black text-gray-900 leading-snug">{rouletteWinner}</h4>
              </div>
            )}
            {!isSpinning && <button onClick={() => setIsRouletteModalOpen(false)} className="mt-6 bg-gray-900 text-white font-bold py-3 px-8 rounded-full shadow-md w-full pointer-events-auto">閉じる</button>}
          </div>
        </div>
      )}

      {flyingItems.map((item) => (
        <div key={item.id} className="fixed pointer-events-none z-[150] animate-float-up flex items-center justify-center" style={{ left: item.x - 30, bottom: '50px' }}>
          {item.type === 'image' ? <img src={item.content} alt="secret" className="w-20 h-20 object-cover rounded-full shadow-xl" /> : <span className="text-5xl drop-shadow-md">{item.content}</span>}
        </div>
      ))}
    </div>
  );
}