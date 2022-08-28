import eventEmitter from 'node:events'
import {exec, execSync} from 'node:child_process'
import chalk from 'chalk'
import * as bip39 from '@scure/bip39'
import {wordlist} from '@scure/bip39/wordlists/english.js'

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
  console.log(
    chalk.bgGreen(
      chalk.black(
        `¬¬ (waiting for a result from function ${chalk.bgBlack(
          chalk.gray(call)
        )})`
      )
    )
  )
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
  `./bitcoin/bin/bitcoind -regtest -txindex=1 -datadir=data/bitcoin -rpcport=18000 -rpcuser=a -rpcpassword=a`
)
await forStdout(bitcoind, 'Bound to')

xs(`mkdir data/electrumx`)
const electrumx = x(
  `NET=regtest COIN=bitcoin DB_DIRECTORY=data/electrumx DAEMON_URL=http://a:a@127.0.0.1:18000 SERVICES=tcp://127.0.0.1:51001,ssl://127.0.0.1:51002 SSL_CERTFILE=${process.cwd()}/ssl_keys/server.crt SSL_KEYFILE=${process.cwd()}/ssl_keys/server.key ./electrumx/venv/bin/python electrumx/electrumx_server`
)
await forStdout(electrumx, 'SSL server listening on 127.0.0.1:51002')

const cln = num =>
  x(
    `./lightning/lightningd/lightningd --network regtest --lightning-dir=data/cln${num} --allow-deprecated-apis=false --plugin=${process.cwd()}/poncho/poncho-out --bind-addr 127.0.0.1:1000${num} --bitcoin-rpcport=18000 --bitcoin-rpcuser=a --bitcoin-rpcpassword=a`
  )
xs(`mkdir data/cln1`)
const cln1 = cln(1)
await forStdout(cln1, 'Server started')
xs(`mkdir data/cln2`)
const cln2 = cln(2)
await forStdout(cln2, 'Server started')

const startCliche = num => {
  let seed = bip39.generateMnemonic(wordlist)
  return x(
    `./cliche/cliche -Dcliche.network=regtest -Dcliche.datadir=data/cliche${num} -Dcliche.seed="${seed}" -Dcliche.websocket.port=3000${num}`
  )
}

const cliches = Array.apply(0, Array(6))
  .map((_, i) => i + 1)
  .map(num => startCliche(num))

const btcli = input =>
  JSON.parse(
    xs(
      `./bitcoin/bin/bitcoin-cli -regtest -rpcport=18000 -rpcuser=a -rpcpassword=a ${input}`,
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
const makeClicheClient =
  p =>
  async (method, params = {}, ...args) => {
    let id = Math.random().toString().slice(-5)
    if (!awaiting)
      console.log(chalk.magenta(`~> ${method} ${JSON.stringify(params)}`))
    return new Promise((resolve, reject) => {
      function handler(data) {
        if (args.indexOf(SUPPRESS_OUTPUT) !== -1)
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
      p.stdin.write(JSON.stringify({method, params, id}) + '\n')
    })
  }
const chclis = cliches.map(makeClicheClient)

try {
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
      forResult(async () => {
        let info = await cli(`getinfo`)
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
  await Promise.all([ln1, ln2].map(p => p('listchannels').channels.length > 0))

  // print all poncho logs
  cln1.stderr.on('data', data => console.log(data))
  cln2.stderr.on('data', data => console.log(data))

  // open hosted channels from cliche to each poncho
  const cln1chclis = chclis.slice(0, Math.round(chclis.length / 3))
  const cln2chclis = chclis.slice(Math.round(chclis.length / 3))
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
  await Promise.all(
    chclis.map(ch =>
      forResult(
        async () => (await ch('get-info')).channels?.[0].policy !== undefined
      )
    )
  )

  // make many payments from 2 to 1
  let invoices = await Promise.all(
    cln1chclis.flatMap(ch =>
      Array.apply(0, Array(36)).map(_ =>
        ch('create-invoice', {msatoshi: 1000000})
      )
    )
  )

  invoices.forEach(inv => console.log(inv))

  console.log(`GOT ${invoices.length} INVOICES`)

  invoices.forEach(inv => console.log(ln2(`pay ${inv.invoice}`)))
  await Promise.all(
    cln1chclis.map(ch =>
      forResult(
        async () => (await ch('get-info').channels[0].can_send) === 36000000
      )
    )
  )
} catch (err) {
  console.error(err)
} finally {
  console.log(chalk.magenta('\n\n~ killing everything'))
  ln1('stop')
  ln2('stop')
  cliches.forEach(cliche => cliche.kill())
  electrumx.kill()
  bitcoind.kill()
  cln1.kill()
  cln2.kill()
}
