import eventEmitter from 'node:events'
import {exec, execSync} from 'node:child_process'
import chalk from 'chalk'

eventEmitter.setMaxListeners(100)
const SUPPRESS_OUTPUT = 'SUPPRESS_OUTPUT'
var awaiting = false

function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

function x(cmd, ...args) {
  if (!awaiting) console.log(chalk.blue(`~> ${cmd}`))
  return exec(cmd, ...args)
}

function xs(cmd, ...args) {
  if (!awaiting) console.log(chalk.blueBright(`~> ${cmd}`))
  try {
    let stdout = execSync(cmd, ...args).toString()
    if (stdout.trim().length && args.indexOf(SUPPRESS_OUTPUT) === -1)
      console.log(chalk.green(' > ' + stdout.replace(/\n/g, '\n > ')))
    return stdout
  } catch (err) {
    console.log(chalk.bgYellow(chalk.black(err.stderr.toString())))
    console.log(chalk.bgRed(chalk.black(err.stdout.toString())))
    throw err
  }
}

function _for(process, streamName, line) {
  return new Promise(resolve => {
    console.log(
      chalk.bgGreen(
        chalk.black(
          `¬¬ (waiting ${streamName} for a line containing "${chalk.bgBlue(
            line
          )}")`
        )
      )
    )
    function handler(data) {
      console.log(data)
      if (data.includes(line)) {
        resolve()
        process[streamName].off('data', handler)
      }
    }
    process[streamName].on('data', handler)
  })
}

function forStderr(process, line) {
  return _for(process, 'stderr', line)
}

function forStdout(process, line) {
  return _for(process, 'stdout', line)
}

async function forResult(call) {
  awaiting = true
  console.log(chalk.black(`¬¬ (waiting for a result ${call})`))
  let x = false
  while (x === false) {
    x = call()
    if (x.then) {
      x = await x
    }
    process.stdout.write('.')
    await sleep(1)
  }
  process.stdout.write('\n')
  awaiting = false
}

xs(`rm -rf data`)
xs(`mkdir data`)

xs(`mkdir data/bitcoin`)
const bitcoind = x(
  `./bitcoin/bin/bitcoind -regtest -txindex=1 -datadir=data/bitcoin -rpcuser=a -rpcpassword=a`
)
await forStdout(bitcoind, 'Bound to')

const cln = num =>
  x(
    `./lightning/lightningd/lightningd --network regtest --lightning-dir=data/cln${num} --allow-deprecated-apis=false --plugin=${process.cwd()}/poncho/poncho-out --bind-addr 127.0.0.1:1000${num} --bitcoin-rpcuser=a --bitcoin-rpcpassword=a`
  )
xs(`mkdir data/cln1`)
const cln1 = cln(1)
await forStdout(cln1, 'Server started')
xs(`mkdir data/cln2`)
const cln2 = cln(2)
await forStdout(cln2, 'Server started')

const cliche1 = x(
  `./cliche/cliche -D cliche.network=regtest -Dcliche.datadir=data/cliche1 -Dcliche.seed="capable hope super horror once upgrade hour mystery square inhale cheap comic" -Dcliche.websocket.port=30001`
)
const cliche2 = x(
  `./cliche/cliche -D cliche.network=regtest -Dcliche.datadir=data/cliche2 -Dcliche.seed="century ginger brisk empty found disagree category yellow icon civil cave stock" -Dcliche.websocket.port=30002`
)
const cliche3 = x(
  `./cliche/cliche -D cliche.network=regtest -Dcliche.datadir=data/cliche3 -Dcliche.seed="axis cream essence surround damage taxi despair way chair post trumpet enter" -Dcliche.websocket.port=30003`
)
const cliche4 = x(
  `./cliche/cliche -D cliche.network=regtest -Dcliche.datadir=data/cliche4 -Dcliche.seed="captain soup noble movie drama begin spring ten fetch alcohol among increase" -Dcliche.websocket.port=30004`
)
const cliche5 = x(
  `./cliche/cliche -D cliche.network=regtest -Dcliche.datadir=data/cliche5 -Dcliche.seed="diary job grit live mammal debate intact submit gather canoe expire furnace" -Dcliche.websocket.port=30005`
)
const cliche6 = x(
  `./cliche/cliche -D cliche.network=regtest -Dcliche.datadir=data/cliche6 -Dcliche.seed="security jacket broken lobster chief again scatter business depend setup sure illegal" -Dcliche.websocket.port=30006`
)
const cliches = [cliche1, cliche2, cliche3, cliche4, cliche5, cliche6]

const electrumx = x(
  `NET=regtest COIN=bitcoin DB_DIRECTORY=data/electrumx DAEMON_URL=127.0.0.1 ./electrumx/venv/bin/python electrumx/electrumx_server`
)

try {
  const btcli = input =>
    JSON.parse(
      xs(
        `./bitcoin/bin/bitcoin-cli -regtest -rpcuser=a -rpcpassword=a ${input}`,
        SUPPRESS_OUTPUT
      )
    )
  const lncli = num => input =>
    JSON.parse(
      xs(
        `./lightning/cli/lightning-cli --network regtest --lightning-dir=data/cln${num} ${input}`,
        SUPPRESS_OUTPUT
      )
    )
  const ln1 = lncli(1)
  const ln2 = lncli(2)
  const chcli =
    p =>
    async (method, params = {}) => {
      let id = Math.random().toString().slice(-5)
      console.log(chalk.magenta(`~> ${method} ${JSON.stringify(params)}`))
      return new Promise((resolve, reject) => {
        function handler(data) {
          console.log(chalk.green(` > ${data}`))
          try {
            let j = JSON.parse(data)
            if (j.id === id) {
              if (j.error) reject(j.error)
              else resolve(j.result)

              p.stdout.off('data', handler)
            }
          } catch (_) {
            /* do nothing */
          }
        }
        p.stdout.on('data', handler)
        p.stdin.write(JSON.stringify({method, params, id}))
      })
    }
  const chclis = cliches.map(chcli)
  const [ch1, ch2, ch3, ch4, ch5, ch6] = chclis

  // open a channel from cln2 to cln1
  let throwaway = ln1('newaddr').bech32
  let addr2 = ln2('newaddr').bech32
  btcli(`generatetoaddress 1 ${addr2}`)
  btcli(`generatetoaddress 100 ${throwaway}`)
  let info1 = ln1('getinfo')
  let info2 = ln2('getinfo')
  ln2(
    `connect ${info1.id} ${info1.binding[0].address} ${info1.binding[0].port}`
  )
  await Promise.all(
    [ln1, ln2].map(cli =>
      forResult(() => {
        let info = cli(`getinfo`)
        return (
          info.warning_bitcoind_sync === undefined &&
          info.warning_lightningd_sync === undefined
        )
      })
    )
  )
  ln2(`fundchannel ${info1.id} 500000`)
  btcli(`generatetoaddress 9 ${throwaway}`)
  await Promise.all(
    [ln1, ln2].map(p => p('listfunds').channels[0]?.state === 'CHANNELD_NORMAL')
  )

  // open hosted channels from cliche to each poncho
  const cln1chclis = chclis.slice(0, 3)
  const cln2chclis = chclis.slice(3)
  await Promise.all(
    cln1chclis
      .map(ch =>
        ch('request-hc', {
          pubkey: info1.id,
          host: info1.binding[0].address,
          port: info1.binding[0].port
        })
      )
      .concat(
        cln2chclis.map(ch =>
          ch('request-hc', {
            pubkey: info2.id,
            host: info2.binding[0].address,
            port: info2.binding[0].port
          })
        )
      )
  )

  // make many payments from 2 to 1
  let invoices = await Promise.all(
    cln2chclis.flatMap(ch =>
      Array.apply(0, Array(15)).map(_ =>
        ch('create-invoice', {msatoshi: 100000})
      )
    )
  )
  console.log(invoices)
  console.log(invoices.length)
} catch (err) {
  console.error(err)
} finally {
  console.log(chalk.magenta('\n\n~ killing everything'))
  bitcoind.kill()
  cln1.kill()
  cln2.kill()
  cliches.forEach(cliche => cliche.kill())
  electrumx.kill()
}
