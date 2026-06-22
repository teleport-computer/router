export default function Loading({ className = "" }: { className?: string }) {
  return (
    <div className={`flex justify-center py-12 ${className}`}>
      <div className="loading-dots" aria-label="Loading">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
