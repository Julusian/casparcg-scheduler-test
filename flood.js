const { CasparCG, AMCP, ConnectionOptions, Options } = require('casparcg-connection')
const Timecode = require('smpte-timecode')
const rgbHex = require('rgb-hex')
const net = require('net')

let opts = new ConnectionOptions('10.42.13.101')
opts.queueMode = Options.QueueMode.SEQUENTIAL

var client = new net.Socket()
client.connect(5250, '10.42.13.101')

let connection = new CasparCG(opts)
connection.diag()
connection.play(1, 11, 'green')

function getTime (channel) {
  return connection.time(1).then(t => new Timecode(t.response.data, 25))
}
function cloneTime (tc) {
  return new Timecode(tc.frameCount, tc.frameRate)
}

connection.scheduleClear().then(console.log).catch(console.log)

getTime(1).then(tc => {
  console.log('Got time', tc.toString(), '(' + tc.frameCount + ' frames)')

  let time1 = cloneTime(tc).add(25) // 1s
  let time2 = cloneTime(tc).add(70) // 3s

  connection.scheduleSet(time1.toString(), new AMCP.PlayCommand({channel: 1, layer: 11, clip: 'BLUE'})).then(r => {
    console.log('Blue')
  })
  connection.scheduleSet(time2.toString(), new AMCP.StopCommand({channel: 1, layer: 11})).then(r => {
    console.log('Cleared')
  })

  // Flood server with 1000s of commands
  let lastTime = cloneTime(tc).add(10000) // 200s
  let col = 0
  let queued = 0
  for (let i = 0; i < 1000000; i++) {
    lastTime.add(1)
    const colStr = '#' + rgbHex(col % 256, col % 256, col % 256)
    const timeStr = lastTime.toString()

    setTimeout(() => {
      client.write('SCHEDULE SET a' + i + ' ' + timeStr + ' PLAY 1-11 ' + colStr + '\r\n')
      // connection.scheduleSet(timeStr, new AMCP.PlayCommand({channel: 1, layer: 11, clip: colStr})).catch(console.log)
      queued += 1

      if (queued % 1000 === 0) {
        console.log('Queued:', queued)
      }
    }, i * 3)

    col += 5
  }

  console.log('All queued up')

  // connection.scheduleList().then(r => {
  //   console.log('ok', r)
  // }).catch(r => {
  //   console.log('fail', r)
  // })
})


