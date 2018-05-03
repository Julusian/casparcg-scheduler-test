const { CasparCG, AMCP, ConnectionOptions } = require('casparcg-connection')
const Timecode = require('smpte-timecode')
const rgbHex = require('rgb-hex')

let opts = new ConnectionOptions('10.42.13.100')
// opts.debug = true

let connection = new CasparCG(opts)
connection.diag()

function getTime (channel) {
  return connection.time(1).then(t => new Timecode(t.response.data, 25))
}
function cloneTime (tc) {
  return new Timecode(tc.frameCount, tc.frameRate)
}

class CmdWrapper {
  constructor (currenTime, time, cmd) {
    this._token = cmd.token
    this._expected = true
    this._completed = false
    this._cancelled = false

    connection.scheduleSet(time.toString(), cmd).then(r => this._executed(r)).catch(r => this._failed(r))

    const frameDiff = (time.frameCount - currenTime.frameCount) * 40 // ms
    if (frameDiff > 0) {
      setTimeout(() => {
        if (!this._completed && !this._cancelled) {
          console.log('ERROR: Command timed out:', this._token)
          this._completed = true
        }
      }, frameDiff + 1000)
    }
  }

  cancel () {
    connection.scheduleRemove(this._token).then(() => {
      this._expected = false
      this._cancelled = true
    }).catch(() => {
      // Ignore error, as probably already run, which we now dont care about
    })
  }

  invalidate () {
    this._completed = false
    this._cancelled = true
  }

  _executed (res) {
    const removed = res.response.raw.indexOf('SCHEDULE REMOVE OK') !== -1
    if (this._completed || (!this._expected && !removed)) {
      console.log('ERROR: Command succeeded unexpectedly:', this._token)
    }

    this._completed = true
  }

  _failed (res) {
    if (this._completed || this._expected) {
      console.log('ERROR: Command failed unexpectedly:', this._token)
    }

    this._completed = true
  }
}

function ScheduleTimer (time) {
  const cmd = new AMCP.TimeCommand({channel: 1})
  const expected = time.frameCount

  connection.scheduleSet(time.toString(), cmd).then(r => {
    const resTime = new Timecode(r.response.data, 25).frameCount
    const diff = resTime - expected
    if (diff !== 0) {
      console.log('ERROR: Time command executed', diff, 'frames late')
    } else {
      console.log('INFO: Time command ok')
    }
  }).catch(r => {
    console.log('ERROR: Time command failed unexpectedly:', cmd.token, r)
  })
}

const scheduledTimes = []

function ScheduleTimesOver24Hours () {
  return getTime(1).then(tc => {
    return new Promise((resolve, reject) => {
      console.log('INFO: Scheduling 24 hour times')

      let lastTime = cloneTime(tc).add(100) // 4s
      const interval = 25 * 60 * 42 // 42 mins
      const count = 25 * 60 * 60 * 24 / interval

      for (let i = 0; i < count; i++) {
        lastTime.add(interval)

        const execTime = cloneTime(lastTime)
        const nowTime = cloneTime(tc).add(i * 10 / 40)
        setTimeout(() => {
          scheduledTimes.push(new CmdWrapper(nowTime, execTime, new AMCP.TimeCommand({channel: 1})))

          if (scheduledTimes.length === Math.ceil(count)) {
            console.log('INFO: 24 hour times scheduled')
            resolve()
          }
        }, i * 10)
      }
    })
  })
}

function ColourFadeTest () {
  return getTime(1).then(tc => {
    return new Promise((resolve, reject) => {
      console.log('INFO: Starting colour fade test')

      const count = 5000
      const spacing = 10

      const cmds = []
      // Flood server with 1000s of commands
      let lastTime = cloneTime(tc).add(100) // 4s
      let col = 0
      for (let i = 0; i < count; i++) {
        lastTime.add(1)
        const colStr = '#' + rgbHex(col % 256, col % 256, col % 256)

        const execTime = cloneTime(lastTime)
        const nowTime = cloneTime(tc).add(i * spacing / 40)
        setTimeout(() => {
          cmds.push(new CmdWrapper(nowTime, execTime, new AMCP.PlayCommand({channel: 1, layer: 11, clip: colStr})))
        }, i * spacing)

        col += 5
      }

      setTimeout(() => {
        for (let i = 0; i < cmds.length; i++) {
          setTimeout(() => {
            cmds[i].cancel()
          }, i * spacing)
        }
      }, count * spacing * 0.2)

      setTimeout(() => {
        console.log('INFO: colour fade completed')

        cmds.forEach(e => e.invalidate())

        resolve()
      }, count * spacing + 2000)
    })
  })
}

function MultiplePlayTest (name, count) {
  return getTime(1).then(tc => {
    return new Promise((resolve, reject) => {
      console.log('INFO: Starting multiple play test')

      const execTime = cloneTime(tc).add(100) // 4s

      const cmds = []
      for (let i = 0; i < count; i++) {
        cmds.push(new CmdWrapper(tc, execTime, new AMCP.PlayCommand({channel: 1, layer: 11 + i, clip: name})))
      }
      ScheduleTimer(execTime)

      const execTime2 = execTime.add(100) // 4s
      for (let i = 0; i < count; i++) {
        cmds.push(new CmdWrapper(tc, execTime2, new AMCP.StopCommand({channel: 1, layer: 11 + i})))
      }
      ScheduleTimer(execTime2)

      setTimeout(() => {
        console.log('INFO: multiple clip test completed')

        cmds.forEach(e => e.invalidate())

        resolve()
      }, 10000)
    })
  })
}

let passCount = 0
function runTestPass () {
  console.log('INFO: Starting pass', (++passCount))

  MultiplePlayTest('AMB', 3)
    .then(ColourFadeTest)
    .then(() => MultiplePlayTest('GREEN', 20))
    .then(() => console.log('INFO: Finished pass'))
    .then(() => setTimeout(runTestPass, 60 * 1000)) // every minute
}

getTime(1).then(tc => {
  console.log('INFO: Start time', tc.toString(), '(' + tc.frameCount + ' frames)')

  process.on('SIGINT', () => {
    console.log('Caught interrupt signal')

    console.log('Pending times:', scheduledTimes.length)
    process.exit()
  })

  connection.scheduleClear()
    .then(() => console.log('INFO: Cleared schedule'))
    .then(ScheduleTimesOver24Hours)
    .then(runTestPass)
})
