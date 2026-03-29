type Props = { content: string };

export function UserMessage({ content }: Props) {
  return (
    <div className="msg user-msg">
      <div className="msg-avatar user-avatar" aria-hidden>
        <svg viewBox="0 0 32 32" fill="none" className="user-svg">
          <circle cx="16" cy="11" r="4" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M8 26c0-5 3.5-8 8-8s8 3 8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="msg-body user-body">
        <p className="user-text">{content}</p>
      </div>
    </div>
  );
}
