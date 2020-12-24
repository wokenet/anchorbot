#!/usr/bin/env node
import fs from 'fs'
import { once } from 'events'
import yargs from 'yargs'
import TOML from '@iarna/toml'
import sdk, { EventType } from 'matrix-js-sdk'
import pkg from '../package.json'

type View = {
  title?: string
  kind: 'hls' | 'embed' | 'offline'
  url: string
  fill: boolean
}

type Config = {
  baseUrl: string
  accessToken: string
  userId: string
  rooms: { anchor: string; announcements: string; curators: string }
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
    .group(['rooms.anchor', 'rooms.announcements', 'rooms.curators'], 'Rooms')
    // FIXME: making these 'required' doesn't seem to work with getting the values via config()
    .option('rooms.anchor', {
      describe: 'Anchor room id',
      string: true,
    })
    .option('rooms.announcements', {
      describe: 'Announcement room id',
      string: true,
    })
    .option('rooms.curators', {
      describe: 'Curator room id',
      string: true,
    })
    .help().argv

  const { server: baseUrl, token: accessToken, 'user-id': userId } = argv

  const aliasConfig = argv.alias as { [name: string]: View }
  const alias = new Map(Object.entries(aliasConfig))

  const rooms = argv.rooms as Config['rooms']

  return { baseUrl, accessToken, userId, rooms, alias }
}

async function main() {
  const { baseUrl, accessToken, userId, rooms, alias } = readConfig()
  const client = sdk.createClient({
    baseUrl,
    userId,
    accessToken,
  })

  await client.startClient()
  await once(client, 'sync')
  for (const roomId of Object.values(rooms)) {
    await client.joinRoom(roomId)
    console.log(`Joined room ${roomId}`)
  }

  client.on('Room.timeline', function (event, room) {
    if (event.getType() !== 'm.room.message') {
      return
    }

    const body: string = event.getContent().body
    if (!body) {
      return
    }

    const parts = body.split(' ')
    const cmd = parts.shift()

    if (cmd === '!bot') {
      client.sendNotice(
        event.getRoomId(),
        `🤖 ${pkg.name} v${pkg.version} (${pkg.homepage})`,
        '',
      )
      return
    }

    // Curator-only commands
    if (room.roomId != rooms.curators) {
      return
    }

    const sender = room.getMember(event.getSender())
    if (sender.powerLevel < 50) {
      return
    }

    if (cmd === '!view' || cmd === '!v') {
      if (parts.length === 0) {
        client.sendNotice(
          event.getRoomId(),
          'Please use !end to clear the view.',
          '',
        )
        return
      }

      let view = alias.get(parts[0])
      if (!view) {
        view = {
          kind: 'embed',
          url: parts[0],
          fill: parts[1] === 'fill',
        }
      }

      client.sendStateEvent(rooms.anchor, AnchorViewEventType, view, '')
      for (const roomId of [rooms.anchor, rooms.curators]) {
        client.sendNotice(roomId, `Now viewing: ${view.title || view.url}`, '')
      }
    } else if (cmd === '!end' || cmd === '!e') {
      client.sendStateEvent(
        rooms.anchor,
        AnchorViewEventType,
        { kind: 'offline' },
        '',
      )
      client.sendNotice(rooms.curators, `Broadcast ended.`, '')
    } else if (cmd === '!announce' || cmd === '!a') {
      const announceText = parts.join(' ')
      client.setRoomTopic(rooms.anchor, announceText)
      client.sendNotice(rooms.announcements, announceText, '')
      client.sendNotice(rooms.curators, `Announcement sent.`, '')
    }
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
