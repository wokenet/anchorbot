#!/usr/bin/env node
import fs from 'fs'
import { once } from 'events'
import yargs from 'yargs'
import TOML from '@iarna/toml'
import sdk, { EventType } from 'matrix-js-sdk'
import pkg from '../package.json'

type View = {
  title?: string
  kind: 'hls' | 'embed'
  url: string
  fill: boolean
}

type Config = {
  baseUrl: string
  accessToken: string
  userId: string
  roomId: string
  alias: Map<string, View>
}

const AnchorViewEventType = 'net.woke.anchor.view' as EventType

function readConfig(): Config {
  const argv = yargs(process.argv.slice(2))
    .config('config', 'Path to TOML config file', (configPath: string) => {
      return TOML.parse(fs.readFileSync(configPath, 'utf-8'))
    })
    .group(['server', 'user-id', 'token'], 'Connection')
    .option('server', {
      describe: 'Server URL',
      required: true,
      string: true,
    })
    .option('user-id', {
      describe: 'User id',
      required: true,
      string: true,
    })
    .option('token', {
      describe: 'Access token',
      required: true,
      string: true,
    })
    .group(['room-id'], 'Room')
    .option('room-id', {
      describe: 'Anchor room id',
      required: true,
      string: true,
    })
    .help().argv

  const {
    server: baseUrl,
    token: accessToken,
    'user-id': userId,
    'room-id': roomId,
  } = argv

  const aliasConfig = argv.alias as { [name: string]: View }
  const alias = new Map(Object.entries(aliasConfig))

  return { baseUrl, accessToken, userId, roomId, alias }
}

async function main() {
  const { baseUrl, accessToken, userId, roomId, alias } = readConfig()
  const client = sdk.createClient({
    baseUrl,
    userId,
    accessToken,
  })

  await client.startClient()
  await once(client, 'sync')
  await client.joinRoom(roomId)
  console.log(`Joined room ${roomId}`)

  client.on('Room.timeline', function (event, room) {
    if (event.getType() !== 'm.room.message') {
      return
    }

    const body: string = event.getContent().body
    if (!body) {
      return
    }

    const parts = body.split(' ')
    const cmd = parts[0]

    if (cmd === '!bot') {
      client.sendTextMessage(
        roomId,
        `🤖 ${pkg.name} v${pkg.version} (${pkg.homepage})`,
        '',
      )
    } else if (cmd === '!view') {
      const sender = room.getMember(event.getSender())
      if (sender.powerLevel < 50) {
        return
      }

      let view = alias.get(parts[1])
      if (!view) {
        view = {
          kind: 'embed',
          url: parts[1],
          fill: parts[2] === 'fill',
        }
      }

      client.sendStateEvent(room.roomId, AnchorViewEventType, view, '')

      client.sendTextMessage(
        roomId,
        `Switching to view: ${view.title || view.url}`,
        '',
      )
    }
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
