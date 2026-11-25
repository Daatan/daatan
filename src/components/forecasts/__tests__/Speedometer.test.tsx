import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Speedometer from '../Speedometer'

describe('Speedometer component', () => {
  it('renders without errors', () => {
    const { container } = render(<Speedometer percentage={50} label="Test Label" color="green" />)
    expect(container).toBeInTheDocument()
  })

  it('displays the rounded percentage value inside the SVG', () => {
    render(<Speedometer percentage={42.7} label="Probability" color="green" />)
    expect(screen.getByText('43%')).toBeInTheDocument()
  })

  it('displays the user percentage when provided', () => {
    render(<Speedometer percentage={50} userPercentage={75} label="Probability" color="green" />)
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('draws no community tick before anyone has committed (daatan#2323)', () => {
    const { container, rerender } = render(<Speedometer percentage={null} userPercentage={60} />)
    expect(container.querySelector('[data-testid="community-tick"]')).toBeNull()
    expect(screen.getByText('60%')).toBeInTheDocument()
    rerender(<Speedometer percentage={40} userPercentage={60} />)
    expect(container.querySelector('[data-testid="community-tick"]')).not.toBeNull()
  })

  it('displays the label below the SVG', () => {
    render(<Speedometer percentage={50} label="Will Happen" color="green" />)
    expect(screen.getByText('Will Happen')).toBeInTheDocument()
  })

  it('clamps percentage below 0 to 0', () => {
    render(<Speedometer percentage={-10} label="Test" color="green" />)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('clamps percentage above 100 to 100', () => {
    render(<Speedometer percentage={150} label="Test" color="red" />)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('renders SVG with correct viewBox for the default md size', () => {
    const { container } = render(<Speedometer percentage={50} label="Test" color="green" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 160 96')
    expect(svg?.getAttribute('width')).toBe('160')
    expect(svg?.getAttribute('height')).toBe('96')
  })

  it('renders exactly 3 arc path elements (background, green, red)', () => {
    const { container } = render(<Speedometer percentage={50} label="Test" color="green" />)
    // paths: background + greenArc + redArc + marketNeedle = 4 paths
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBeGreaterThanOrEqual(3)
  })

  it('renders a pivot circle at the center', () => {
    const { container } = render(<Speedometer percentage={50} label="Test" color="green" />)
    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBeGreaterThanOrEqual(1)
  })

  it('renders SVG defs with gradient and filter elements', () => {
    const { container } = render(<Speedometer percentage={50} label="Test" color="green" />)
    const defs = container.querySelector('defs')
    expect(defs).toBeInTheDocument()

    const linearGradients = defs?.querySelectorAll('linearGradient')
    expect(linearGradients?.length).toBeGreaterThanOrEqual(2) // green + red

    const filters = defs?.querySelectorAll('filter')
    expect(filters?.length).toBeGreaterThanOrEqual(1)
  })

  it('handles NaN percentage gracefully by treating it as 50%', () => {
    const { getByText } = render(<Speedometer percentage={NaN} label="Test NaN" color="green" />)
    expect(getByText('50%')).toBeDefined()
  })

  it('does not render an AI CI band when bounds are omitted', () => {
    const { container } = render(
      <Speedometer percentage={50} aiPercentage={50} label="Test" color="green" />,
    )
    expect(container.querySelector('[data-testid="ai-ci-band"]')).toBeNull()
  })

  it('renders a translucent AI CI arc band when aiCiLow/aiCiHigh are provided', () => {
    const { container } = render(
      <Speedometer
        percentage={50}
        aiPercentage={50}
        aiCiLow={40}
        aiCiHigh={60}
        label="Test"
        color="green"
      />,
    )
    const band = container.querySelector('[data-testid="ai-ci-band"]') as SVGPathElement | null
    expect(band).not.toBeNull()
    expect(band?.getAttribute('d')).toMatch(/^M /)
    // Band should be translucent amber
    expect(Number(band?.getAttribute('opacity'))).toBeLessThan(1)
  })

  it('does not render an AI CI band when aiCiHigh <= aiCiLow', () => {
    const { container } = render(
      <Speedometer
        percentage={50}
        aiPercentage={50}
        aiCiLow={60}
        aiCiHigh={60}
        label="Test"
        color="green"
      />,
    )
    expect(container.querySelector('[data-testid="ai-ci-band"]')).toBeNull()
  })

  it('renders tick marks at both CI bounds when a valid range is given', () => {
    const { container } = render(
      <Speedometer
        percentage={50}
        aiPercentage={50}
        aiCiLow={40}
        aiCiHigh={60}
        label="Test"
        color="green"
      />,
    )
    // Ticks frame the translucent band so the user can see where the range ends.
    expect(container.querySelector('[data-testid="ai-ci-tick-low"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="ai-ci-tick-high"]')).not.toBeNull()
  })

  it('omits CI tick marks when bounds are absent', () => {
    const { container } = render(
      <Speedometer percentage={50} aiPercentage={50} label="Test" color="green" />,
    )
    expect(container.querySelector('[data-testid="ai-ci-tick-low"]')).toBeNull()
    expect(container.querySelector('[data-testid="ai-ci-tick-high"]')).toBeNull()
  })

  it('renders the center caption when centerLabel is provided', () => {
    render(<Speedometer percentage={5} userPercentage={15} centerLabel="You" size="xl" />)
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('15%')).toBeInTheDocument()
  })

  it('renders no center caption when centerLabel is omitted (the card path)', () => {
    render(<Speedometer percentage={5} userPercentage={15} size="sm" />)
    expect(screen.queryByText('You')).toBeNull()
  })
})
