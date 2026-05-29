export default function Videos() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">🎬 Відео</h1>
        <p className="text-dark-400 text-sm">
          Записи гонок, онборди та найкращі моменти з картодрому.
        </p>
      </div>

      <div className="card text-center py-12">
        <div className="text-4xl mb-3">📹</div>
        <h3 className="text-white font-semibold mb-2">Скоро буде</h3>
        <p className="text-dark-400 text-sm max-w-md mx-auto">
          Тут зʼявляться записи гонок та онборди. Інтеграція з YouTube — в роботі.
        </p>
      </div>
    </div>
  );
}
