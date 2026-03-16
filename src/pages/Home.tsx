import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="text-center py-12 sm:py-20">
        <div className="inline-flex items-center gap-2 bg-primary-500/10 text-primary-400 px-4 py-1.5 rounded-full text-sm font-medium mb-6">
          <span className="w-2 h-2 bg-primary-400 rounded-full animate-pulse" />
          Картодром
        </div>
        <h1 className="text-4xl sm:text-6xl font-black text-white mb-4 leading-tight">
          Результати та<br />
          <span className="text-primary-500">статистика</span> змагань
        </h1>
        <p className="text-dark-400 text-lg max-w-2xl mx-auto mb-8">
          Відстежуй результати гонок, аналізуй таймінг в реальному часі,
          переглядай статистику пілотів та карт.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            to="/info/timing"
            className="bg-primary-600 hover:bg-primary-500 text-white px-6 py-3 rounded-xl font-semibold transition-colors"
          >
            🏎️ Live таймінг
          </Link>
          <Link
            to="/results/current"
            className="bg-dark-800 hover:bg-dark-700 text-white px-6 py-3 rounded-xl font-semibold transition-colors border border-dark-700"
          >
            📊 Поточне змагання
          </Link>
        </div>
      </section>

      {/* Quick links */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <QuickCard
          title="Гонзалес"
          description="Регулярні змагання для досвідчених пілотів"
          href="/results/gonzales"
          emoji="🏆"
        />
        <QuickCard
          title="Лайт Ліга"
          description="Ліга для новачків та аматорів"
          href="/results/light-league"
          emoji="⭐"
        />
        <QuickCard
          title="Ліга Чемпіонів"
          description="Найпрестижніші змагання картодрому"
          href="/results/champions-league"
          emoji="👑"
        />
        <QuickCard
          title="Спринти"
          description="Короткі інтенсивні гонки"
          href="/results/sprints"
          emoji="⚡"
        />
        <QuickCard
          title="Марафони"
          description="Довгі гонки на витривалість"
          href="/results/marathons"
          emoji="🏁"
        />
        <QuickCard
          title="Карти"
          description="Статистика та інформація про карти"
          href="/info/karts"
          emoji="🔧"
        />
        <QuickCard
          title="Траси"
          description="11 конфігурацій траси картодрому"
          href="/info/tracks"
          emoji="🗺️"
        />
      </section>
    </div>
  );
}

function QuickCard({ title, description, href, emoji }: {
  title: string;
  description: string;
  href: string;
  emoji: string;
}) {
  return (
    <Link
      to={href}
      className="card group hover:border-dark-600 hover:bg-dark-800/50 transition-all duration-200"
    >
      <div className="text-3xl mb-3">{emoji}</div>
      <h3 className="text-white font-bold text-lg mb-1 group-hover:text-primary-400 transition-colors">
        {title}
      </h3>
      <p className="text-dark-400 text-sm">{description}</p>
    </Link>
  );
}
