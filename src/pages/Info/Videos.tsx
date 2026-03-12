export default function Videos() {
  // Placeholder videos — will be replaced with real content later
  const PLACEHOLDER_VIDEOS = [
    {
      title: 'Фінал Гонзалес — Раунд 3',
      description: 'Напружений фінал з боротьбою за перші місця до останнього кола.',
      date: '2025-03-10',
      thumbnail: null,
      url: '#',
    },
    {
      title: 'Лайт Ліга — Найкращі моменти',
      description: 'Підбірка найцікавіших моментів з другого етапу Лайт Ліги.',
      date: '2025-02-17',
      thumbnail: null,
      url: '#',
    },
    {
      title: 'Onboard — Макаревич А.',
      description: 'Камера на борту під час практики. Огляд траси.',
      date: '2025-02-15',
      thumbnail: null,
      url: '#',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">🎬 Відео</h1>
        <p className="text-dark-400 text-sm">
          Записи гонок, онборди та найкращі моменти з картодрому "Жага швидкості".
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {PLACEHOLDER_VIDEOS.map((video, i) => (
          <a
            key={i}
            href={video.url}
            className="card group p-0 overflow-hidden hover:border-dark-600 transition-colors"
          >
            {/* Thumbnail placeholder */}
            <div className="aspect-video bg-dark-800 flex items-center justify-center">
              <svg
                className="w-16 h-16 text-dark-600 group-hover:text-primary-500 transition-colors"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div className="p-4">
              <h3 className="text-white font-semibold mb-1 group-hover:text-primary-400 transition-colors">
                {video.title}
              </h3>
              <p className="text-dark-400 text-sm mb-2">{video.description}</p>
              <span className="text-dark-500 text-xs">{video.date}</span>
            </div>
          </a>
        ))}
      </div>

      <div className="card text-center py-12">
        <div className="text-4xl mb-3">📹</div>
        <h3 className="text-white font-semibold mb-2">Скоро буде більше</h3>
        <p className="text-dark-400 text-sm max-w-md mx-auto">
          Ми працюємо над інтеграцією з YouTube для автоматичного
          додавання відео з гонок. Залишайтесь на зв'язку!
        </p>
      </div>
    </div>
  );
}
