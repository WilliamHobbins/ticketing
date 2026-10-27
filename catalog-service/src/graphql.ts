import { createYoga, createSchema } from 'graphql-yoga';
import { useDisableIntrospection } from '@graphql-yoga/plugin-disable-introspection';
import * as repo from './repo';
import { isProd } from './config';

const typeDefs = /* GraphQL */ `
  type Venue { id: ID! name: String! city: String! address: String sectors: [Sector!]! }
  type Sector { id: ID! name: String! rows: Int! seatsPerRow: Int! priceFactor: Float! }
  type Seat { id: ID! sector: String! row: String! number: Int! price: Float! status: String! }
  type Event {
    id: ID! title: String! description: String category: String! startsAt: String!
    basePrice: Float! minPrice: Float venue: Venue! seats: [Seat!]!
  }
  type Query {
    events(q: String, city: String, limit: Int = 50): [Event!]!
    event(id: ID!): Event
    venues: [Venue!]!
    venue(id: ID!): Venue
  }
`;

// Solo lectura. Los resolvers reutilizan el repo (y por lo tanto la caché Redis).
export const yoga = createYoga({
  schema: createSchema({
    typeDefs,
    resolvers: {
      Query: {
        events: (_: unknown, a: any) => repo.listEvents(a),
        event: (_: unknown, a: { id: string }) => repo.getEvent(a.id),
        venues: () => repo.listVenues(),
        venue: (_: unknown, a: { id: string }) => repo.getVenue(a.id),
      },
      Event: {
        venue: (e: any) => repo.getVenue(e.venueId),
        seats: (e: any) => repo.eventSeats(e.id),
        startsAt: (e: any) => new Date(e.startsAt).toISOString(),
      },
      Venue: { sectors: (v: any) => repo.listSectors(v.id) },
    },
  }),
  graphqlEndpoint: '/api/v1/catalog/graphql',
  graphiql: !isProd,                                  // sandbox solo fuera de producción
  plugins: isProd ? [useDisableIntrospection()] : [], // sin introspección en producción
  logging: false,
});
