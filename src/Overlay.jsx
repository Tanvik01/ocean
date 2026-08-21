export default function Overlay() {
  return (
    <div className="overlay">
      <section className="title">
        <h1>
          Golden
          <em>Hour</em>
        </h1>
        <p>An evening sea, simulated ripple by ripple.</p>
        <span className="cue">scroll to descend</span>
      </section>

      <section className="note" style={{ top: '215vh' }}>
        <p>Light bends at the surface and folds onto the sand below.</p>
      </section>

      <section className="note" style={{ top: '400vh' }}>
        <p>Past forty metres the last of the orange is gone.</p>
      </section>

      <section className="note" style={{ top: '560vh' }}>
        <p>The kelp keeps moving anyway, on a current that started at the surface.</p>
      </section>

      <section className="seabed-message" style={{ top: '650vh' }}>
        <p>Seabed reached.</p>
      </section>
    </div>
  )
}
