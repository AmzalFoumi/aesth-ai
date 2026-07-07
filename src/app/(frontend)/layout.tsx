import React from 'react'
import './styles.css'

export const metadata = {
  description: 'AI beauty advisor over a live product catalog.',
  title: 'aesth-ai — Beauty Advisor',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}
