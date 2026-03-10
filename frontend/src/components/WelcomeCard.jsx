import './WelcomeCard.css'

const CHIPS = [
  { label: 'Search patient',  query: 'Show patient details of Ethan Carter' },
  { label: 'View conditions', query: 'Show conditions for patient 44231' },
  { label: 'Lab results',     query: 'What is the hemoglobin count for patient 44231?' },
  { label: 'Medications',     query: 'List medications for patient 44231' },
  { label: 'Encounters',      query: 'Show encounters for patient 44231' },
]

/**
 * Welcome card displayed before the first message.
 * Chip clicks prefill and send a starter query.
 */
export default function WelcomeCard({ userName, onChipClick }) {
  return (
    <div className="welcome-card">
      <img src="/chatbot_image/chatbot.png" alt="CareBridge" className="wc-avatar" style={{borderRadius:0,background:'none',padding:0}} />
      <h3>Hey {userName}, how can I assist you today?</h3>
      <p>
        Search patient records, retrieve lab results, conditions, medications,
        encounters, and procedures.
      </p>
      <div className="welcome-chips">
        {CHIPS.map(chip => (
          <button
            key={chip.label}
            className="chip"
            onClick={() => onChipClick(chip.query)}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  )
}
